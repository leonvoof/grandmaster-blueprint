"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { loadGameReplay } from "@/lib/game-replay";
import { buildTrainingTree, playAnswer, startExercise, type Exercise } from "@/lib/opening-trainer";
import { decodeProgress, maxBackupBytes, puzzles, readProgress, saveProgress, validatedPgn, type PublicProgress } from "@/lib/public-progress";
import { parsePuzzleRow } from "@/lib/tactics";
import { StockfishAnalysis } from "@/components/stockfish-analysis";

const panel = "rounded-2xl border border-white/10 bg-[#11131b] p-4 sm:p-6";
type Move = { from: Square; to: Square; promotion?: string };
type Update = (change: (previous: PublicProgress) => PublicProgress) => boolean;

function Board({ fen, move, black = false }: { fen: string; move: (move: Move) => boolean; black?: boolean }) {
  const [selection, setSelection] = useState<{ fen: string; square: Square } | null>(null);
  const selected = selection?.fen === fen ? selection.square : null;
  function click(square: Square) {
    const position = new Chess(fen);
    if (position.get(square)?.color === position.turn()) {
      setSelection({ fen, square });
      return;
    }
    if (!selected) return;
    const promotion = position.moves({ square: selected, verbose: true }).some((candidate) => candidate.to === square && candidate.promotion);
    if (!promotion) move({ from: selected, to: square });
    setSelection(null);
  }
  return <div className="mx-auto w-full max-w-[560px]">
    <Chessboard position={fen} boardOrientation={black ? "black" : "white"} animationDuration={150}
      onSquareClick={click}
      customSquareStyles={selected ? { [selected]: { backgroundColor: "rgba(139, 92, 246, 0.55)" } } : {}}
      onPieceDrop={(from, to) => { setSelection(null); return move({ from, to }); }}
      onPromotionCheck={(from, to) => new Chess(fen).moves({ square: from, verbose: true }).some((candidate) => candidate.to === to && candidate.promotion)}
      onPromotionPieceSelect={(piece, from, to) => Boolean(piece && from && to && move({ from, to, promotion: piece[1].toLowerCase() }))} />
    <p className="mt-2 text-sm text-gray-400">{new Chess(fen).turn() === "w" ? "White" : "Black"} to move</p>
  </div>;
}

export function PublicWorkspace({ section }: { section: "games" | "analysis" | "openings" | "tactics" }) {
  const [progress, setProgress] = useState<PublicProgress | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    function refresh() {
      try { setProgress(readProgress(localStorage)); }
      catch { setMessage("Browser progress could not be read. You can restore a valid backup below."); }
    }
    refresh();
    window.addEventListener("storage", refresh);
    return () => window.removeEventListener("storage", refresh);
  }, []);
  function update(change: (previous: PublicProgress) => PublicProgress) {
    try {
      setProgress(saveProgress(localStorage, change(readProgress(localStorage))));
      setMessage("");
      return true;
    } catch {
      setMessage("Progress could not be saved. The browser may be out of storage or the workspace limit was reached.");
      return false;
    }
  }
  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > maxBackupBytes) throw new Error("Backup exceeds the size limit.");
      const data = decodeProgress(await file.text());
      if (!window.confirm("Replace the public workspace progress in this browser with this backup?")) return;
      setProgress(saveProgress(localStorage, data));
      setMessage("Backup restored.");
    } catch { setMessage("Could not restore this file. Existing progress was preserved."); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(progress, null, 0)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "knightforge-progress.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const title = { games: "Games", analysis: "Analysis board", openings: "Opening recall", tactics: "Tactics" }[section];
  return <div className="space-y-6">
    <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
    {section === "tactics" ? <Tactics progress={progress} update={update} /> :
      <PgnWorkspace key={section} training={section === "openings"} progress={progress} update={update} />}
    <details className={panel}>
      <summary className="cursor-pointer font-semibold">Backup &amp; restore</summary>
      <p className="my-3 max-w-2xl text-sm text-gray-400">Saved games, opening lines, and completion counts stay in this browser. They do not sync across devices and may be lost when browser storage is cleared. Engine cache entries are temporary and are excluded from backups.</p>
      <div className="flex flex-wrap items-center gap-4">
        <button className="btn" disabled={!progress} onClick={download}>Download progress</button>
        <label className="text-sm">Restore progress <input type="file" accept=".json,application/json" onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} /></label>
      </div>
    </details>
    {message && <p role="status" className="text-sm text-violet-200">{message}</p>}
    <p className="text-sm text-gray-400">Account sync, private game reviews, server-saved analyses, repertoire notes, spaced repetition, and profile statistics are available only in the authenticated workspace.</p>
  </div>;
}

function PgnWorkspace({ training, progress, update }: { training: boolean; progress: PublicProgress | null; update: Update }) {
  const [fen, setFen] = useState(() => new Chess().fen());
  const [black, setBlack] = useState(false);
  const [source, setSource] = useState("");
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  const [cursor, setCursor] = useState(0);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [fenInput, setFenInput] = useState("");
  const entries = progress?.games.filter((game) => game.kind === (training ? "opening" : "game")) ?? [];
  const replay = loaded && !training ? loadGameReplay(loaded) : null;
  function load(pgn: string, persist: boolean) {
    try {
      const chess = validatedPgn(pgn);
      const clean = pgn.trim();
      setLoaded(clean);
      setSource(clean);
      setExercise(null);
      setError("");
      setCursor(0);
      setFen(chess.history({ verbose: true })[0].before);
      if (persist) {
        const headers = chess.getHeaders();
        const name = (headers.Event && headers.Event !== "?" ? headers.Event : "Untitled PGN").slice(0, 100);
        update((data) => data.games.some((game) => game.pgn === clean && game.kind === (training ? "opening" : "game"))
          ? data : { ...data, games: [...data.games, { pgn: clean, name, kind: training ? "opening" : "game" }] });
      }
    } catch { setError("Use one valid PGN with legal moves and at least one half-move."); }
  }
  function selectPly(ply: number) {
    if (!replay) return;
    setCursor(ply);
    setFen(replay.moves[ply - 1]?.fen ?? replay.initialFen);
  }
  function start() {
    const { roots } = buildTrainingTree([{ pgn: loaded }]);
    if (!roots.length) return;
    const next = startExercise(roots[0], black ? "b" : "w", Math.random);
    setExercise(next);
  }
  function move(input: Move) {
    if (training) {
      if (!exercise || exercise.status !== "player") return false;
      const result = playAnswer(exercise, input, Math.random);
      setExercise(result.state);
      if (result.accepted && result.state.status === "complete") update((data) => ({ ...data, recalls: data.recalls + 1 }));
      return result.accepted;
    }
    try {
      const position = new Chess(fen);
      position.move(input);
      setFen(position.fen());
      return true;
    } catch { return false; }
  }
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className={panel}>
        <Board fen={exercise?.position.fen ?? fen} move={move} black={black} />
        {!training && <StockfishAnalysis fen={fen} gameId="knightforge-public" />}
      </div>
      <div className={panel}>
        <label className="block text-sm">Paste {training ? "opening line" : "game"} PGN
          <textarea className="field my-2 w-full" rows={4} maxLength={16000} value={source} onChange={(event) => setSource(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={() => load(source, false)}>Load PGN</button>
          <button className="btn" disabled={!progress} onClick={() => load(source, true)}>Save PGN in this browser</button>
        </div>
        <label className="my-3 block text-sm">Open a PGN file <input type="file" accept=".pgn,application/x-chess-pgn,text/plain" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file && file.size <= 64_000) void file.text().then((pgn) => load(pgn, false), () => setError("Could not read this PGN file."));
          else if (file) setError("PGN file exceeds the size limit.");
        }} /></label>
        {entries.length > 0 && <label className="my-3 block text-sm">Saved PGNs
          <select className="field mt-1 w-full" value="" onChange={(event) => load(entries[Number(event.target.value)].pgn, false)}>
            <option value="" disabled>Choose a saved PGN</option>
            {entries.map((entry, index) => <option key={index} value={index}>{entry.name}</option>)}
          </select>
        </label>}
        {training ? <>
          <p className="mb-2 text-sm text-gray-400">Recall the main line of a PGN you provide. Completed runs in this browser: {progress?.recalls ?? "—"}.</p>
          <label className="text-sm">Practice as <select className="field" value={black ? "black" : "white"} onChange={(event) => { setBlack(event.target.value === "black"); setExercise(null); }}><option value="white">White</option><option value="black">Black</option></select></label>
          <button className="btn ml-2" disabled={!loaded} onClick={start}>Start recall</button>
          <p role="status" className="mt-3 text-sm">{exercise?.status === "complete" ? "Line complete." : exercise?.feedback}</p>
        </> : <>
          <div className="my-3 flex flex-wrap gap-2">
            <button className="btn" onClick={() => { setLoaded(""); setFen(new Chess().fen()); setError(""); }}>Reset board</button>
            <button className="btn" onClick={() => setBlack(!black)}>Flip board</button>
          </div>
          <label className="block text-sm">Position FEN <input className="field my-2 w-full" maxLength={150} value={fenInput} onChange={(event) => setFenInput(event.target.value)} /></label>
          <button className="btn" onClick={() => {
            try { setFen(new Chess(fenInput).fen()); setLoaded(""); setError(""); }
            catch { setError("Enter a legal FEN."); }
          }}>Load FEN</button>
          {replay && <div className="mt-4 max-h-48 overflow-auto" aria-label="Game moves">
            <button className="btn" onClick={() => selectPly(0)}>Start</button>
            {replay.moves.map(({ san }, i) => <button className="btn m-0.5" aria-pressed={cursor === i + 1} key={i} onClick={() => selectPly(i + 1)}>{i + 1}. {san}</button>)}
          </div>}
        </>}
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}

function Tactics({ progress, update }: { progress: PublicProgress | null; update: Update }) {
  const [selected, setSelected] = useState(0);
  const puzzle = puzzles[selected];
  return <div className={panel}>
    <label className="text-sm">Choose a puzzle <select className="field" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>
      {puzzles.map(({ id, rating }, index) => <option key={id} value={index}>#{id} · {rating}</option>)}
    </select></label>
    <Puzzle key={puzzle.id} row={puzzle} solved={() => update((data) => ({ ...data, solves: { ...data.solves, [puzzle.id]: (data.solves[puzzle.id] ?? 0) + 1 } }))}>
      <p className="my-3 text-sm text-gray-400">Completed in this browser: {progress?.solves[puzzle.id] ?? 0}. <a className="underline" href="https://database.lichess.org/#puzzles">Lichess Puzzle Database · CC0</a></p>
    </Puzzle>
  </div>;
}

function Puzzle({ row, solved, children }: { row: typeof puzzles[number]; solved: () => void; children: ReactNode }) {
  const puzzle = parsePuzzleRow(row);
  const line = row.moves.split(" ").slice(1);
  const [fen, setFen] = useState(puzzle.fen);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  function move(input: Move) {
    if (index >= line.length) return false;
    const board = new Chess(fen);
    try { board.move(input); } catch { return false; }
    if (input.from + input.to + (input.promotion ?? "") !== line[index]) {
      setFeedback("Try another move.");
      return false;
    }
    const reply = line[index + 1];
    if (reply) board.move({ from: reply.slice(0, 2), to: reply.slice(2, 4), promotion: reply[4] });
    const next = Math.min(index + 2, line.length);
    setFen(board.fen());
    setIndex(next);
    setFeedback(next === line.length ? "Puzzle solved." : "Correct. Find the next move.");
    if (next === line.length) solved();
    return true;
  }
  return <>{children}<Board fen={fen} black={new Chess(puzzle.fen).turn() === "b"} move={move} />
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button className="btn" onClick={() => { setIndex(0); setFen(puzzle.fen); setFeedback(""); }}>Restart puzzle</button>
      <p role="status" className="text-sm text-violet-200">{feedback}</p>
    </div>
  </>;
}
