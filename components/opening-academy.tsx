"use client";

import { useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { lineIdentity, linePgn, positionForMoves } from "@/lib/opening-tree";
import { OpeningRecallTrainer } from "@/components/opening-recall-trainer";
import { OpeningMasteryDashboard } from "@/components/opening-mastery-dashboard";
import { OpeningExplorer } from "@/components/opening-explorer";

type Line = { id: string; name: string; pgn: string; preferred: boolean };
type Chapter = { id: string; name: string; category: string; lines: Line[]; notes: { fen: string; text: string }[] };
type Repertoire = { id: string; name: string; side: string; chapters: Chapter[] };
const categories = ["ponziani", "italian", "caro-kann", "custom"];

export function OpeningAcademy() {
  const [repertoires, setRepertoires] = useState<Repertoire[]>([]);
  const [repertoiresLoaded, setRepertoiresLoaded] = useState(false);
  const [repertoireId, setRepertoireId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [lineId, setLineId] = useState("");
  const [lineName, setLineName] = useState("");
  const [lineInput, setLineInput] = useState("");
  const [moves, setMoves] = useState<string[]>([]);
  const [startFen, setStartFen] = useState<string | undefined>();
  const [fenInput, setFenInput] = useState("");
  const [ply, setPly] = useState(0);
  const [note, setNote] = useState("");
  const [repertoireName, setRepertoireName] = useState("");
  const [chapterName, setChapterName] = useState("");
  const [chapterCategory, setChapterCategory] = useState("custom");
  const [side, setSide] = useState("White");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [practice, setPractice] = useState(false);
  const [practiceLaunch, setPracticeLaunch] = useState<{ repertoireId?: string; chapterId?: string; positionId?: string } | null>(null);
  const repertoire = repertoires.find((item) => item.id === repertoireId);
  const chapter = repertoire?.chapters.find((item) => item.id === chapterId);
  const selectedLine = chapter?.lines.find((item) => item.id === lineId);
  const activeMoves = useMemo(() => moves.slice(0, ply), [moves, ply]);
  const position = useMemo(() => positionForMoves(moves, ply, startFen), [moves, ply, startFen]);
  const currentNote = chapter?.notes.find((item) => item.fen === position)?.text ?? "";

  async function refresh() {
    try {
      const response = await fetch("/api/openings");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load repertoires.");
      setRepertoires(data.repertoires);
      setRepertoireId((current) => current || data.repertoires[0]?.id || "");
    } finally { setRepertoiresLoaded(true); }
  }
  useEffect(() => { void refresh().catch((error) => setMessage(error.message)); }, []);
  useEffect(() => { setNote(currentNote); }, [currentNote]);
  useEffect(() => { setFenInput(position); }, [position]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("practice") === "due") {
      setPracticeLaunch({});
      setPractice(true);
    }
  }, []);

  async function request(url: string, method: string, body: object) {
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "The change could not be saved.");
    return data;
  }
  async function createRepertoire() {
    setBusy(true); setMessage("");
    try { const data = await request("/api/openings", "POST", { name: repertoireName, side }); await refresh(); setRepertoireId(data.repertoire.id); setRepertoireName(""); setMessage("Repertoire created."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create repertoire."); }
    finally { setBusy(false); }
  }
  async function createChapter() {
    setBusy(true); setMessage("");
    try { const data = await request("/api/openings/chapters", "POST", { repertoireId, name: chapterName, category: chapterCategory }); await refresh(); setChapterId(data.chapter.id); setChapterName(""); setMessage("Chapter created."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not create chapter."); }
    finally { setBusy(false); }
  }
  function selectLine(line: Line) {
    try { const chess = new Chess(); chess.loadPgn(line.pgn); const nextMoves = chess.history(); setStartFen(chess.getHeaders().FEN); setLineId(line.id); setLineName(line.name); setMoves(nextMoves); setPly(0); setLineInput(line.pgn); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Saved variation could not be read."); }
  }
  function drop(from: string, to: string) {
    try {
      const chess = new Chess(position);
      const played = chess.move({ from, to, promotion: "q" });
      const candidate = [...activeMoves, played.san];
      const candidatePgn = linePgn(candidate, startFen);
      const matching = chapter?.lines.find((line) => lineIdentity(line.pgn) === lineIdentity(candidatePgn));
      if (matching) { selectLine(matching); setPly(candidate.length); setMessage("Existing branch selected."); return true; }
      if (ply < moves.length && !window.confirm("Create a separate branch from this position? The existing continuation will be preserved.")) return false;
      setMoves(candidate); setPly(candidate.length); setLineId(""); setLineInput(candidatePgn); setMessage("Move added to this variation. Save it to keep the change."); return true;
    } catch { setMessage("That move is illegal in this position."); return false; }
  }
  function navigateExplorerMove(san: string) {
    try {
      const chess = new Chess(position);
      const played = chess.move(san);
      const nextMoves = [...activeMoves, played.san];
      setMoves(nextMoves); setPly(nextMoves.length); setLineId(""); setLineInput(linePgn(nextMoves, startFen));
      setMessage(`Navigated with ${played.san}. Saved repertoire lines are unchanged; use “Add to selected chapter” to save a continuation.`);
    } catch { setMessage("The explorer move is not legal in the current position."); }
  }
  async function addExplorerMove(san: string) {
    if (!chapterId) { setMessage("Select a target chapter before adding an explorer move."); return; }
    setBusy(true);
    try {
      const chess = new Chess(position);
      const played = chess.move(san);
      const nextMoves = [...activeMoves, played.san];
      const data = await request(`/api/openings/${chapterId}`, "PATCH", {
        action: "line", name: `Explorer continuation · ${played.san}`, pgn: linePgn(nextMoves, startFen), preferred: false,
      });
      await refresh(); setMoves(nextMoves); setPly(nextMoves.length); setLineId(data.line.id); setLineName(data.line.name); setLineInput(data.line.pgn);
      setMessage(`${played.san} was explicitly added as a new variation in ${chapter?.name ?? "the selected chapter"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Explorer continuation was not saved."); }
    finally { setBusy(false); }
  }
  function loadExplorerFen() {
    try {
      const loaded = new Chess(fenInput).fen();
      setStartFen(loaded); setMoves([]); setPly(0); setLineId(""); setLineName(""); setLineInput("");
      setMessage("Custom FEN loaded. The explorer is using the current board position.");
    } catch { setMessage("That FEN is invalid. The board and saved repertoire were not changed."); }
  }
  async function saveLine() {
    if (!chapterId || !lineName.trim()) { setMessage("Choose a chapter and name this variation first."); return; }
    setBusy(true); setMessage("");
    try {
      const pgn = linePgn(moves, startFen);
      const data = await request(`/api/openings/${chapterId}`, "PATCH", { action: "line", id: lineId || undefined, name: lineName, pgn, preferred: selectedLine?.preferred ?? false });
      await refresh(); setLineId(data.line.id); setLineInput(data.line.pgn); setMessage("Variation saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save variation."); }
    finally { setBusy(false); }
  }
  async function lineAction(action: string, extra: object) {
    if (!chapterId) return;
    setBusy(true); setMessage("");
    try { await request(`/api/openings/${chapterId}`, "PATCH", { action, ...extra }); await refresh(); setMessage(action === "delete-line" ? "Variation deleted." : "Preference saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Change failed."); }
    finally { setBusy(false); }
  }
  async function saveNote() {
    setBusy(true); setMessage("");
    try { await request(`/api/openings/${chapterId}`, "PATCH", { action: "note", fen: position, text: note }); await refresh(); setMessage("Position note saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Note could not be saved."); }
    finally { setBusy(false); }
  }
  async function importPgn(value: string) {
    if (!repertoireId) { setMessage("Choose a repertoire before importing PGN."); return; }
    setBusy(true); setMessage("");
    try {
      const data = await request("/api/openings/import", "POST", { repertoireId, pgn: value });
      await refresh();
      setMessage(`Imported ${data.games} game(s), ${data.linesCreated} line(s), ${data.notesCreated} position note(s). ${data.duplicates} duplicate line(s) skipped.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "PGN import failed. No chapters were added."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1200px]">
    <h1 className="text-3xl">Opening Academy</h1><p className="mt-2 text-sm text-gray-400">Build and study your own legal repertoire lines.</p>
    {practice && repertoiresLoaded ? <OpeningRecallTrainer repertoires={repertoires} initialMode={practiceLaunch ? "due" : "normal"}
      initialRepertoireId={practiceLaunch?.repertoireId} initialChapterId={practiceLaunch?.chapterId} initialPositionId={practiceLaunch?.positionId}
      onClose={() => { setPractice(false); setPracticeLaunch(null); }} /> : practice ? <p className="mt-4 text-sm text-gray-400">Loading saved repertoires…</p> : <>
    <OpeningMasteryDashboard repertoires={repertoires}
      onStartReview={(nextRepertoireId, nextChapterId) => { setPracticeLaunch({ repertoireId: nextRepertoireId, chapterId: nextChapterId }); setPractice(true); }}
      onPracticePosition={(nextRepertoireId, nextChapterId, positionId) => { setPracticeLaunch({ repertoireId: nextRepertoireId, chapterId: nextChapterId, positionId }); setPractice(true); }} />
    <button className="btn mt-4" onClick={() => setPractice(true)}>Practice</button>
    <div className="mt-5 grid gap-4 lg:grid-cols-[240px_minmax(300px,1fr)_320px]">
      <aside className="rounded-xl border border-white/10 p-4">
        <select aria-label="Repertoire" className="field w-full" value={repertoireId} onChange={(event) => { setRepertoireId(event.target.value); setChapterId(""); setLineId(""); setMoves([]); setStartFen(undefined); setPly(0); }}><option value="">Choose repertoire</option>{repertoires.map((item) => <option key={item.id} value={item.id}>{item.side}: {item.name}</option>)}</select>
        <select aria-label="Repertoire side" className="field mt-2 w-full" value={side} onChange={(event) => setSide(event.target.value)}><option>White</option><option>Black</option></select><input className="field mt-2 w-full" value={repertoireName} onChange={(event) => setRepertoireName(event.target.value)} placeholder="New repertoire name"/><button className="btn mt-2 w-full" disabled={busy} onClick={() => void createRepertoire()}>Create repertoire</button>
        <h2 className="mt-5 text-sm">Chapters</h2>{repertoire?.chapters.map((item) => <button key={item.id} className="block w-full p-2 text-left text-sm" onClick={() => { setChapterId(item.id); setLineId(""); setMoves([]); setStartFen(undefined); setPly(0); }}>{item.name} <span className="text-xs text-gray-500">{item.category}</span></button>)}
        {repertoire && <><input className="field mt-3 w-full" value={chapterName} onChange={(event) => setChapterName(event.target.value)} placeholder="Chapter name"/><select className="field mt-2 w-full" value={chapterCategory} onChange={(event) => setChapterCategory(event.target.value)}>{categories.map((category) => <option key={category}>{category}</option>)}</select><button className="btn mt-2 w-full" disabled={busy} onClick={() => void createChapter()}>Add chapter</button></>}
      </aside>
      <section className="rounded-xl border border-white/10 p-4">
        <div className="mx-auto max-w-[560px]"><Chessboard position={position} onPieceDrop={drop}/></div>
        <div className="mt-3 flex flex-wrap gap-2"><button className="btn" disabled={!ply} onClick={() => setPly(0)}>Beginning</button><button className="btn" disabled={!ply} onClick={() => setPly((value) => value - 1)}>Previous</button><button className="btn" disabled={ply >= moves.length} onClick={() => setPly((value) => value + 1)}>Next</button><button className="btn" disabled={ply >= moves.length} onClick={() => setPly(moves.length)}>End</button><button className="btn" disabled={!moves.length || ply===moves.length} onClick={() => { if(window.confirm("Remove the selected line continuation after this position?")){setMoves(activeMoves);setLineId("");setLineInput("");setMessage("Continuation trimmed locally. Save as a new branch to preserve the original line.");}}}>Trim from here</button></div>
        <div className="mt-3 flex flex-wrap gap-2"><input aria-label="Position FEN" className="field min-w-0 flex-1 text-xs" value={fenInput} onChange={(event) => setFenInput(event.target.value)} /><button className="btn" onClick={loadExplorerFen}>Load FEN</button><button className="btn" onClick={() => void navigator.clipboard.writeText(position)}>Copy FEN</button></div>
        <div className="mt-3 flex flex-wrap gap-1">{moves.map((san, index) => <button key={`${index}-${san}`} className={`rounded px-2 py-1 text-sm ${ply === index + 1 ? "bg-purple-700" : "hover:bg-white/10"}`} onClick={() => setPly(index + 1)}>{Math.floor(index / 2) + 1}{index % 2 ? "…" : "."} {san}</button>)}</div>
        <label className="mt-4 block text-xs text-gray-400">Import or inspect PGN<textarea className="field mt-2 h-24 w-full" value={lineInput} onChange={(event) => setLineInput(event.target.value)} placeholder="Paste one or more PGN games with nested variations"/></label><input type="file" accept=".pgn,text/plain" className="mt-2 text-sm" onChange={async (event) => { const file = event.target.files?.[0]; if (file) setLineInput(await file.text()); }}/><button className="btn mt-2" disabled={busy} onClick={() => void importPgn(lineInput)}>Import PGN into repertoire</button>
        {repertoire && <button className="btn ml-2 mt-2" onClick={() => window.open(`/api/openings/export?repertoireId=${encodeURIComponent(repertoire.id)}`, "_blank")}>Export repertoire PGN</button>}{chapter && <button className="btn ml-2 mt-2" onClick={() => window.open(`/api/openings/export?chapterId=${encodeURIComponent(chapter.id)}`, "_blank")}>Export chapter PGN</button>}
        {chapter && <div className="mt-3 flex flex-wrap gap-2"><input className="field min-w-0 flex-1" value={lineName} onChange={(event) => setLineName(event.target.value)} placeholder="Variation name"/><button className="btn" disabled={busy || !moves.length} onClick={() => void saveLine()}>Save variation</button><button className="btn" onClick={() => navigator.clipboard.writeText(linePgn(moves, startFen))}>Copy PGN</button></div>}
      </section>
      <aside className="rounded-xl border border-white/10 p-4"><OpeningExplorer fen={position} repertoireId={repertoireId} chapterId={chapterId} busy={busy} onNavigate={navigateExplorerMove} onAdd={(san) => void addExplorerMove(san)} /><h2 className="mt-5 font-medium">Variation branches</h2>{chapter?.lines.map((item) => <div key={item.id} className="mt-2 flex gap-1"><button className={`min-w-0 flex-1 rounded p-2 text-left text-sm ${lineId === item.id ? "bg-purple-700/30" : ""}`} onClick={() => selectLine(item)}>{item.preferred ? "★ " : ""}{item.name}</button><button className="btn" aria-label="Toggle preferred" onClick={() => void lineAction("preferred", { id: item.id, preferred: !item.preferred })}>★</button><button className="btn" aria-label="Delete branch" disabled={busy} onClick={() => { if (window.confirm(`Delete variation “${item.name}”?`)) void lineAction("delete-line", { id: item.id }); }}>×</button></div>)}
        <h3 className="mt-5 text-sm">Position notes</h3><textarea className="field mt-2 min-h-40 w-full" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Plans, pawn breaks, piece placement, tactical ideas…"/><button className="btn mt-2" disabled={busy || !chapterId} onClick={() => void saveNote()}>Save note at this position</button>{message && <p role="status" className="mt-3 text-xs text-gray-300">{message}</p>}
      </aside>
    </div>
    </>}
  </div>;
}
