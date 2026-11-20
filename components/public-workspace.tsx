"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Chess, type Square } from "chess.js";
import { Chessboard } from "react-chessboard";
import { GameViewer } from "@/components/game-viewer";
import { exportBrowserReviews, restoreBrowserReviews } from "@/lib/browser-game-review";
import { buildTrainingTree, playAnswer, startExercise, type Exercise } from "@/lib/opening-trainer";
import { lichessCooldownKey, lichessImportLimits, LichessImportError, mergeLichessGames, requestPublicLichessGames, withSingleLichessImport, type LichessTimeControl } from "@/lib/public-lichess";
import { decodeProgress, maxBackupBytes, puzzles, readProgress, recordTacticsAttempt, saveProgress, tacticsFirstTryRate, validatedPgn, type PublicProgress, type PublicGame, type TacticsAttempt } from "@/lib/public-progress";
import { buildPuzzleNextUrl, parseNextPuzzle, parsePuzzleRow, puzzleDifficultyOptions, puzzleThemeOptions, type PuzzleDifficulty, type PuzzleInput, type PuzzleTheme, visiblePuzzleThemeLabels } from "@/lib/tactics";


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
  const [restoreVersion, setRestoreVersion] = useState(0);
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
      const text = await file.text();
      const data = decodeProgress(text);
      if (!window.confirm("Replace the public workspace progress in this browser with this backup?")) return;
      await restoreBrowserReviews(JSON.parse(text).gameReview, () => { saveProgress(localStorage, data); });
      setProgress(data);
      setRestoreVersion((version) => version + 1);
      setMessage("Backup restored.");
    } catch { setMessage("Could not restore this file. Existing progress was preserved."); }
  }
  async function download() {
    if (!progress) return;
    try {
      const gameReview = await exportBrowserReviews();
      const blob = new Blob([JSON.stringify({ ...progress, gameReview })], { type: "application/json" });
      if (blob.size > maxBackupBytes) throw new Error("The complete backup exceeds 4 MB.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = "knightforge-progress.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not export the browser backup."); }
  }
  const title = { games: "Games", analysis: "Analysis board", openings: "Opening recall", tactics: "Tactics" }[section];
  const gamesWorkspace = section === "games" || section === "analysis";
  return <div className={gamesWorkspace ? "knightforge-public-games" : "space-y-6"}>
    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    {section === "tactics" ? <Tactics progress={progress} update={update} /> :
      <PgnWorkspace key={section} training={section === "openings"} lichessImport={section === "games"} progress={progress} update={update} restoreVersion={restoreVersion} />}
    <details className={`${panel} ${gamesWorkspace ? "knightforge-backup-panel" : ""}`}>
      <summary className="cursor-pointer font-semibold">Backup &amp; restore</summary>
      <p className="my-3 max-w-2xl text-sm text-gray-400">Saved games, game reviews, reflections, opening lines, and completion counts stay in this browser. They do not sync across devices and may be lost when browser storage is cleared. Engine cache entries are temporary and are excluded from backups.</p>
      <div className="flex flex-wrap items-center gap-4">
        <button className="btn" disabled={!progress} onClick={download}>Download progress</button>
        <label className="text-sm">Restore progress <input type="file" accept=".json,application/json" onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} /></label>
      </div>
    </details>
    {message && <p role="status" className={`text-sm text-violet-200 ${gamesWorkspace ? "knightforge-workspace-message" : ""}`}>{message}</p>}
    <p className={gamesWorkspace ? "knightforge-workspace-footnote" : "text-sm text-gray-400"}>Account sync, repertoire notes, spaced repetition, and profile statistics are available in the authenticated workspace.</p>
  </div>;
}

function PgnWorkspace({ training, lichessImport, progress, update, restoreVersion }: { training: boolean; lichessImport: boolean; progress: PublicProgress | null; update: Update; restoreVersion: number }) {
  const [fen, setFen] = useState(() => new Chess().fen());
  const [black, setBlack] = useState(false);
  const [source, setSource] = useState("");
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  const [imported, setImported] = useState<PublicGame | null>(null);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [lichessUsername, setLichessUsername] = useState("");
  const [lichessTimeControl, setLichessTimeControl] = useState<LichessTimeControl>("all");
  const [lichessLimit, setLichessLimit] = useState(50);
  const [lichessBusy, setLichessBusy] = useState(false);
  const [lichessStatus, setLichessStatus] = useState("");
  const [lichessError, setLichessError] = useState("");
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const entries = progress?.games.filter((game) => game.kind === (training ? "opening" : "game")) ?? [];
  useEffect(() => {
    const cooldown = Number(localStorage.getItem(lichessCooldownKey));
    if (Number.isFinite(cooldown) && cooldown > Date.now()) setCooldownUntil(cooldown);
  }, []);
  useEffect(() => {
    if (!cooldownUntil) return;
    const timer = window.setInterval(() => {
      if (cooldownUntil <= Date.now()) { setCooldownUntil(0); window.clearInterval(timer); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownUntil]);
  function load(pgn: string, persist: boolean) {
    try {
      const chess = validatedPgn(pgn);
      const clean = pgn.trim();
      setLoaded(clean);
      setSource(clean);
      setExercise(null);
      setError("");
      setFen(chess.history({ verbose: true })[0].before);
      if (persist) {
        const headers = chess.getHeaders();
        const name = (headers.Event && headers.Event !== "?" ? headers.Event : "Untitled PGN").slice(0, 100);
        update((data) => data.games.some((game) => game.pgn === clean && game.kind === (training ? "opening" : "game"))
          ? data : { ...data, games: [...data.games, { pgn: clean, name, kind: training ? "opening" : "game" }] });
      }
    } catch { setError("Use one valid PGN with legal moves and at least one half-move."); }
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
    return false;
  }
  async function importFromLichess() {
    if (lichessBusy) return;
    setLichessBusy(true);
    setLichessError("");
    setLichessStatus("Connecting directly to Lichess…");
    try {
      await withSingleLichessImport(async () => {
        const result = await requestPublicLichessGames({
          username: lichessUsername,
          timeControl: lichessTimeControl,
          limit: lichessLimit,
          storage: localStorage,
          existing: readProgress(localStorage).games,
          onProgress: (bytes) => setLichessStatus(`Downloading Lichess PGNs · ${(bytes / 1024).toFixed(0)} KB received…`),
        });
        if (!result.returned) {
          setLichessStatus("No completed games matched those filters. Try another time control or username.");
          return;
        }
        let summary: ReturnType<typeof mergeLichessGames> = { games: [], imported: 0, duplicates: 0, capacitySkipped: 0 };
        const saved = update((previous) => {
          summary = mergeLichessGames(previous.games, result.candidates);
          return { ...previous, games: summary.games };
        });
        if (!saved) {
          setLichessError("Games were downloaded but could not be saved in this browser. Existing progress was preserved. Free browser storage and try again.");
          setLichessStatus("");
          return;
        }
        if (summary.imported > 0) setImported(summary.games[summary.games.length - summary.imported]);
        const parts = [`Imported ${summary.imported} game${summary.imported === 1 ? "" : "s"}`];
        if (summary.duplicates) parts.push(`skipped ${summary.duplicates} duplicate${summary.duplicates === 1 ? "" : "s"}`);
        if (result.invalid) parts.push(`rejected ${result.invalid} invalid PGN${result.invalid === 1 ? "" : "s"}`);
        if (result.overLimit) parts.push(`ignored ${result.overLimit} games beyond the selected limit`);
        if (summary.capacitySkipped) parts.push(`could not save ${summary.capacitySkipped} because the local library is full`);
        setLichessStatus(`${parts.join(" · ")}. Games are stored in this browser.`);
      });
    } catch (error) {
      if (error instanceof LichessImportError && error.retryAt) setCooldownUntil(error.retryAt);
      setLichessStatus("");
      setLichessError(error instanceof Error ? error.message : "Lichess import failed. You can import a PGN file below.");
    } finally { setLichessBusy(false); }
  }
  const cooldownSeconds = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)) : 0;
  if (!training) return <GameViewer key={restoreVersion} local={{
    games: entries,
    imported,
    restoreVersion,
    save: (pgn, name) => update((data) => data.games.some((game) => game.kind === "game" && game.pgn === pgn)
      ? data : { ...data, games: [...data.games, { pgn, name, kind: "game" }] }),
    importPanel: lichessImport && <section className="knightforge-lichess-import mb-6 rounded-xl border border-violet-300/20 bg-violet-300/[0.04] p-4" aria-label="Import from Lichess">
          <h2 className="font-semibold">Import from Lichess</h2>
          <p className="my-2 text-sm text-gray-400">Import public, completed games directly from Lichess. No KnightForge account, Lichess login, or token is needed. Games stay in this browser.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">Lichess username
              <input className="field mt-1 w-full" autoComplete="off" maxLength={30} value={lichessUsername} onChange={(event) => setLichessUsername(event.target.value)} placeholder="username" />
            </label>
            <label className="block text-sm">Time control
              <select className="field mt-1 w-full" value={lichessTimeControl} onChange={(event) => setLichessTimeControl(event.target.value as LichessTimeControl)}>
                <option value="all">All supported time controls</option>
                <option value="classical">Classical</option>
                <option value="rapid">Rapid</option>
                <option value="blitz">Blitz</option>
              </select>
            </label>
            <label className="block text-sm">Most recent games
              <select className="field mt-1 w-full" value={lichessLimit} onChange={(event) => setLichessLimit(Number(event.target.value))}>
                {lichessImportLimits.map((limit) => <option key={limit} value={limit}>{limit} games</option>)}
              </select>
            </label>
            <div className="flex items-end">
              <button className="knightforge-import-action btn w-full bg-violet-400/20" type="button" disabled={!progress || lichessBusy || Boolean(cooldownSeconds)} onClick={() => void importFromLichess()}>
                {lichessBusy ? "Importing…" : cooldownSeconds ? `Wait ${cooldownSeconds}s` : "Import Games"}
              </button>
            </div>
          </div>
          {lichessStatus && <p role="status" className="mt-3 text-sm text-violet-200">{lichessStatus}</p>}
          {lichessError && <p role="alert" className="mt-3 text-sm text-red-300">{lichessError}</p>}
          <p className="mt-3 text-xs leading-5 text-gray-500">Requests go from your browser directly to Lichess and are capped at your selected limit. If your network or browser blocks cross-origin access, download a PGN from Lichess and paste or open it below.</p>
        </section>,
  }} />;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className={panel}>
        <Board fen={exercise?.position.fen ?? fen} move={move} black={black} />
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
        {entries.length > 0 && <label className="my-3 block text-sm">{training ? "Saved opening lines" : "Local game library"}
          <select className="field mt-1 w-full" value="" onChange={(event) => load(entries[Number(event.target.value)].pgn, false)}>
            <option value="" disabled>Choose a saved PGN</option>
            {entries.map((entry, index) => <option key={index} value={index}>{entry.name}{entry.source === "lichess" ? ` · Lichess${entry.sourceUsername ? ` @${entry.sourceUsername}` : ""}` : ""}</option>)}
          </select>
        </label>}
          <p className="mb-2 text-sm text-gray-400">Recall the main line of a PGN you provide. Completed runs in this browser: {progress?.recalls ?? "—"}.</p>
          <label className="text-sm">Practice as <select className="field" value={black ? "black" : "white"} onChange={(event) => { setBlack(event.target.value === "black"); setExercise(null); }}><option value="white">White</option><option value="black">Black</option></select></label>
          <button className="btn ml-2" disabled={!loaded} onClick={start}>Start recall</button>
          <p role="status" className="mt-3 text-sm">{exercise?.status === "complete" ? "Line complete." : exercise?.feedback}</p>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      </div>
    </div>
  );
}

type PuzzleRun = { puzzle: PuzzleInput; difficulty: PuzzleDifficulty; theme: PuzzleTheme; incorrectMove: boolean; interacted: boolean; finalized: boolean; pending?: TacticsAttempt };
function createPuzzleRun(row: PuzzleInput, difficulty: PuzzleDifficulty, theme: PuzzleTheme): PuzzleRun {
  return { puzzle: row, difficulty, theme, incorrectMove: false, interacted: false, finalized: false };
}

function Tactics({ progress, update }: { progress: PublicProgress | null; update: Update }) {
  const [selected, setSelected] = useState(0);
  const [active, setActive] = useState<PuzzleInput>(puzzles[0]);
  const [difficulty, setDifficulty] = useState<PuzzleDifficulty>("normal");
  const [theme, setTheme] = useState<PuzzleTheme>("mix");
  const [request, setRequest] = useState(0);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState("");
  const [themesVisible, setThemesVisible] = useState(false);
  const [presentation, setPresentation] = useState(0);
  const recentIds = useRef<string[]>([]);
  const requestEpoch = useRef(0);
  const runRef = useRef<PuzzleRun | null>(null);
  if (!runRef.current) runRef.current = createPuzzleRun(puzzles[0], "normal", "mix");
  function finishAttempt(solved: boolean, skipped: boolean) {
    if (solved || skipped) setThemesVisible(true);
    const run = runRef.current;
    if (!run || run.finalized) return;
    const attempt = run.pending ?? {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      puzzleId: run.puzzle.id,
      timestamp: new Date().toISOString(),
      difficulty: run.difficulty,
      theme: run.theme,
      solved,
      incorrectMove: run.incorrectMove,
      skipped,
      rating: Number.isInteger(run.puzzle.rating) ? run.puzzle.rating : null,
    };
    run.pending = attempt;
    const saved = update((previous) => {
      if (previous.tacticsAttempts.some(({ id }) => id === attempt.id)) return previous;
      const next = recordTacticsAttempt(previous, attempt);
      return attempt.solved ? { ...next, solves: { ...next.solves, [attempt.puzzleId]: (next.solves[attempt.puzzleId] ?? 0) + 1 } } : next;
    });
    if (saved) run.finalized = true;
  }
  const finishAttemptRef = useRef(finishAttempt);
  finishAttemptRef.current = finishAttempt;
  function markMoveAttempt(incorrect = false) {
    const run = runRef.current;
    if (run && !run.finalized) {
      run.interacted = true;
      if (incorrect) run.incorrectMove = true;
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++requestEpoch.current;
    setLoading(true); setFetchError("");
    void (async () => {
      try {
        let next: PuzzleInput | null = null;
        for (let tries = 0; tries < 3 && !next; tries++) {
          const response = await fetch(buildPuzzleNextUrl(difficulty, theme), { credentials: "omit", headers: { Accept: "application/json" }, signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 429 ? "Lichess is temporarily rate limiting puzzle requests." : `Puzzle request failed (${response.status}).`);
          const candidate = parseNextPuzzle(await response.json());
          if (!recentIds.current.includes(candidate.id) || tries === 2) next = candidate;
        }
        if (!controller.signal.aborted && epoch === requestEpoch.current && next) {
          const previousRun = runRef.current;
          if (request > 0 || previousRun?.interacted) finishAttemptRef.current(false, true);
          runRef.current = createPuzzleRun(next, difficulty, theme);
          setThemesVisible(false);
          setPresentation((value) => value + 1);
          setActive(next); recentIds.current = [...recentIds.current.filter((id) => id !== next!.id), next!.id].slice(-8); setSelected(-1);
        }
      } catch (error) {
        if (!controller.signal.aborted && epoch === requestEpoch.current) setFetchError(error instanceof Error ? error.message : "Could not load a Lichess puzzle.");
      } finally { if (!controller.signal.aborted && epoch === requestEpoch.current) setLoading(false); }
    })();
    return () => controller.abort();
  }, [request, difficulty, theme]);
  const fallback = selected >= 0 ? puzzles[selected] : null;
  const puzzle = fallback ?? active;
  const totals = progress?.tacticsTotals;
  const firstTryRate = totals ? tacticsFirstTryRate(totals) : null;
  function requestNext() { setThemesVisible(true); requestEpoch.current += 1; setRequest((n) => n + 1); }
  function chooseFallback(index: number) {
    requestEpoch.current += 1;
    const next = puzzles[index];
    finishAttempt(false, true);
    runRef.current = createPuzzleRun(next, difficulty, theme);
    setThemesVisible(false);
    setPresentation((value) => value + 1);
    setSelected(index);
    setLoading(false);
    setFetchError("");
  }
  return <div className={`${panel} knightforge-public-tactics`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[#70d6b8]">Tactics practice</p><h2 className="mt-1 text-xl font-semibold">Find the best move</h2></div><button className="knightforge-import-action btn min-h-11 px-4" onClick={requestNext}>Next Puzzle <span aria-hidden="true">→</span></button></div>
    <section aria-label="Tactics performance" className="mt-4 rounded-xl border border-[#70d6b8]/15 bg-gradient-to-br from-[#70d6b8]/[.07] to-transparent p-3 sm:p-4">
      <div className="mb-3"><h3 className="text-sm font-semibold text-gray-100">Your Tactics Performance</h3><p className="mt-1 text-[11px] leading-5 text-gray-500">A puzzle counts when solved or skipped; simply loading it does not count.</p></div>
      {progress === null ? <p className="text-sm text-gray-400">Loading saved performance…</p> : totals?.attempted === 0 ? <p className="rounded-lg border border-white/[.06] bg-black/15 px-3 py-3 text-sm text-gray-400">No completed puzzles yet. Solve or skip a puzzle to start your history.</p> : <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {[["Puzzles attempted", totals?.attempted], ["Puzzles solved", totals?.solved], ["First-try solve rate", firstTryRate === null ? null : `${firstTryRate}%`], ["Current clean streak", totals?.currentCleanStreak], ["Best clean streak", totals?.bestCleanStreak]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-white/[.06] bg-[#0b1012]/70 px-3 py-2.5"><p className="text-[10px] leading-4 text-gray-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-[#8bdac1]">{value ?? "—"}</p></div>)}
        </div>
        <p className="mt-3 text-[10px] leading-4 text-gray-500">First-try rate = solves with no incorrect legal move ÷ completed puzzle sessions; skips count as not solved. Any mistake or skip resets the clean-solve streak.</p>
      </>}
    </section>
    <div className="mt-4 grid gap-3 rounded-xl border border-white/[.07] bg-black/20 p-3 sm:grid-cols-2 sm:p-4">
      <label className="grid gap-1.5 text-xs font-medium text-gray-400">Difficulty
        <select className="field min-h-10 w-full" value={difficulty} onChange={(event) => { requestEpoch.current += 1; setRequest((n) => n + 1); setDifficulty(event.target.value as PuzzleDifficulty); }}>
          {puzzleDifficultyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-xs font-medium text-gray-400">Tactical theme
        <select className="field min-h-10 w-full" value={theme} onChange={(event) => { requestEpoch.current += 1; setRequest((n) => n + 1); setTheme(event.target.value as PuzzleTheme); }}>
          {puzzleThemeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      <p className="text-[11px] leading-5 text-gray-500 sm:col-span-2">Difficulty is relative to Lichess’s anonymous-user reference rating, not an exact puzzle rating range.</p>
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-400"><span>#{puzzle.id} · {puzzle.rating}</span><span className="rounded-full border border-white/10 px-2 py-1">{fallback ? "Offline fallback · filters not applied" : "Lichess puzzle"}</span>{loading && <span role="status" className="text-[#8bdac1]">Loading matching puzzle…</span>}{themesVisible && visiblePuzzleThemeLabels(puzzle.themes, true).map((label) => <span key={label} className="rounded-full border border-[#70d6b8]/20 bg-[#70d6b8]/[.07] px-2 py-1 text-[#b9eedb]">{label}</span>)}<a className="underline decoration-white/20 underline-offset-4 hover:text-[#8bdac1]" href="https://database.lichess.org/#puzzles">Lichess Puzzle Database · CC0</a></div>
    {fetchError && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300/15 bg-amber-200/[.04] p-3 text-sm text-amber-100/80" role="status"><span>{fetchError} The current puzzle is still available; offline fallback puzzles do not apply the selected filters.</span><button className="btn" onClick={requestNext}>Retry</button></div>}
    <Puzzle key={`${presentation}:${puzzle.id}:${selected}`} row={puzzle} solved={() => finishAttempt(true, false)} skipped={() => finishAttempt(false, true)} moveAttempted={() => markMoveAttempt()} incorrect={() => markMoveAttempt(true)}>
      <p className="my-3 text-sm text-gray-400">Completed in this browser: {progress?.solves[puzzle.id] ?? 0}.</p>
    </Puzzle>
    <label className="mt-4 block text-xs text-gray-500">Offline fallback set <select className="field ml-2 min-h-9" value={selected >= 0 ? selected : ""} onChange={(event) => { if (event.target.value !== "") chooseFallback(Number(event.target.value)); }}><option value="">Use Lichess puzzle</option>{puzzles.map(({ id, rating }, index) => <option key={id} value={index}>#{id} · {rating}</option>)}</select></label>
  </div>;
}

function Puzzle({ row, solved, skipped, moveAttempted, incorrect, children }: { row: PuzzleInput; solved: () => void; skipped: () => void; moveAttempted: () => void; incorrect: () => void; children: ReactNode }) {
  const puzzle = parsePuzzleRow(row);
  const line = row.setupApplied ? row.moves.trim().split(/\s+/) : row.moves.split(" ").slice(1);
  const [fen, setFen] = useState(puzzle.fen);
  const [index, setIndex] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  function move(input: Move) {
    if (index >= line.length || revealed) return false;
    const board = new Chess(fen);
    try { board.move(input); } catch { return false; }
    moveAttempted();
    if (input.from + input.to + (input.promotion ?? "") !== line[index]) {
      setFeedback("Incorrect. Try another legal move.");
      incorrect();
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
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button className="btn" onClick={() => { setHint(true); setFeedback("Hint: look for a forcing move by the highlighted piece."); }}>Hint</button>
      <button className="btn" onClick={() => { setRevealed(true); setFeedback(`Solution: ${line.join(" ")}`); skipped(); }}>Show solution</button>
      <p role="status" className="text-sm text-[#8bdac1]">{feedback}</p>
      {hint && !feedback && <span className="text-xs text-gray-400">Find a forcing move.</span>}
    </div>
  </>;
}
