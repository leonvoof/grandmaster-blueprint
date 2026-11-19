"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Chess } from "chess.js";
import { Chessboard } from "react-chessboard";
import { continuationPosition, getReviewHint, mistakeReviewTargetForKey, reviewBoardOrientation, reviewPlayerColor } from "@/lib/mistake-review-ui";
import { shouldIgnoreGameViewerShortcut, type BoardOrientation } from "@/lib/game-viewer-controls";

type Critical = { ply: number; moveNumber: number; san: string | null; classification: string; alternative: string | null; variation: string[]; before?: number; after?: number; loss?: number; engine?: string; depth?: number; analysisId?: string; fen?: string };
type EventRecord = { id: string; kind: string; submittedSan: string | null; matchedBest: boolean | null; createdAt: string };
type Reflection = { thinking: string; overlooked: string; variations: string; learned: string; recognition: string };
type Stored = { analysisId: string; reflection: Reflection; events: EventRecord[] };
type ReviewColor = "both" | "white" | "black" | "mine";
const blank: Reflection = { thinking: "", overlooked: "", variations: "", learned: "", recognition: "" };
const prompts: { key: keyof Reflection; label: string }[] = [
  { key: "thinking", label: "What I was thinking during the game" },
  { key: "overlooked", label: "What I overlooked" },
  { key: "variations", label: "My calculated variations" },
  { key: "learned", label: "What I learned" },
  { key: "recognition", label: "How I will recognize similar situations" },
];

export function MistakeReviewSession({
  gameId, critical, onSelect, onExit, openingName, playerColor,
}: {
  gameId: string;
  critical: Critical[];
  onSelect: (ply: number) => void;
  onExit: () => void;
  openingName?: string;
  playerColor?: BoardOrientation | null;
}) {
  const [color, setColor] = useState<ReviewColor>(playerColor ? "mine" : "both");
  const [index, setIndex] = useState(0);
  const [stored, setStored] = useState<Record<string, Stored>>({});
  const [move, setMove] = useState("");
  const [candidateFen, setCandidateFen] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [finished, setFinished] = useState(false);
  const [hint, setHint] = useState("");
  const [continuationPly, setContinuationPly] = useState(0);
  const [feedback, setFeedback] = useState<{ submittedSan?: string | null; matchedBest?: boolean | null; message: string } | null>(null);
  const [reflection, setReflection] = useState<Reflection>(blank);
  const [reflectionDirty, setReflectionDirty] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [orientationMode, setOrientationMode] = useState<"auto" | BoardOrientation>("auto");
  const [sessionStartedAt] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    void fetch(`/api/games/${encodeURIComponent(gameId)}/reviews`).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load review history.");
      if (!active) return;
      const next: Record<string, Stored> = {};
      for (const item of data.reviews as Stored[]) next[item.analysisId] = item;
      setStored(next);
    }).catch((error) => { if (active) setStatus(error instanceof Error ? error.message : "Could not load review history."); });
    return () => { active = false; };
  }, [gameId]);

  const candidates = useMemo(() => critical.filter((item) => {
    if (!item.analysisId || !item.fen || !item.san) return false;
    const side = reviewPlayerColor(item.ply);
    if (color === "both") return true;
    if (color === "mine") return playerColor === side;
    return color === side;
  }), [critical, color, playerColor]);
  const current = candidates[index] ?? null;
  const currentStored = current?.analysisId ? stored[current.analysisId] : undefined;
  const events = currentStored?.events ?? [];
  const position = current?.fen ?? new Chess().fen();
  const moverColor = current ? reviewPlayerColor(current.ply) : null;
  const orientation = reviewBoardOrientation(orientationMode, moverColor);
  const continuation = useMemo(() => current ? (current.variation.length ? current.variation : current.alternative ? [current.alternative] : []) : [], [current]);
  const playedFen = useMemo(() => {
    if (!current || continuationPly < 1) return position;
    try { return continuationPosition(position, continuation, continuationPly); }
    catch { return position; }
  }, [current, continuationPly, position, continuation]);
  const visibleFen = revealed && continuationPly > 0 ? playedFen : candidateFen ?? position;
  const candidateIds = new Set(candidates.flatMap((item) => item.analysisId ? [item.analysisId] : []));
  const sessionPositionEvents = Object.entries(stored).filter(([analysisId]) => candidateIds.has(analysisId)).map(([analysisId, item]) => ({
    analysisId,
    events: item.events.filter((event) => Date.parse(event.createdAt) >= sessionStartedAt),
  })).filter((item) => item.events.length > 0);
  const recentEvents = sessionPositionEvents.flatMap((item) => item.events);
  const sessionSummary = {
    positions: sessionPositionEvents.length,
    submissions: recentEvents.filter((event) => event.kind === "submit").length,
    firstDecisions: sessionPositionEvents.filter(({ events: positionEvents }) => ["submit", "hint", "reveal"].includes(positionEvents[0]?.kind ?? "")).filter(({ events: positionEvents }) => positionEvents[0]?.kind === "submit").length,
    firstMatches: sessionPositionEvents.filter(({ events: positionEvents }) => {
      const firstDecision = positionEvents.find((event) => ["submit", "hint", "reveal"].includes(event.kind));
      return firstDecision?.kind === "submit" && firstDecision.matchedBest === true;
    }).length,
    hints: recentEvents.filter((event) => event.kind === "hint").length,
    reveals: recentEvents.filter((event) => event.kind === "reveal").length,
  };
  const progress = candidates.length ? Math.min(index + (finished ? 1 : 0), candidates.length) : 0;
  const unaidedAccuracy = sessionSummary.firstDecisions ? Math.round(sessionSummary.firstMatches / sessionSummary.firstDecisions * 100) : null;

  const navigate = useCallback((nextIndex: number) => {
    if (nextIndex < 0) return;
    if (nextIndex >= candidates.length) { setFinished(true); return; }
    setFinished(false);
    setIndex(nextIndex);
  }, [candidates.length]);

  useEffect(() => {
    setIndex(0);
    setFinished(false);
  }, [color, playerColor]);

  useEffect(() => {
    setMove(""); setCandidateFen(null); setRevealed(false); setHint(""); setContinuationPly(0); setFeedback(null);
    setReflection(currentStored?.reflection ?? blank); setReflectionDirty(false);
    if (current) onSelect(Math.max(0, current.ply - 1));
    // Review selection intentionally navigates the parent game position to the pre-move ply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.analysisId, current?.ply]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || shouldIgnoreGameViewerShortcut(event.target)) return;
      const target = mistakeReviewTargetForKey(event.key, index, candidates.length);
      if (target !== null) { event.preventDefault(); void navigateWithSave(target); }
      else if (event.key === "Escape") { event.preventDefault(); void exitWithSave(); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // The named handlers below are refreshed by the state dependencies they capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, candidates.length, navigate, onExit, reflectionDirty, reflection, busy]);

  async function save(action: string, extra: Record<string, unknown> = {}) {
    if (!current?.analysisId || busy) return null;
    setBusy(true); setStatus("");
    try {
      const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/reviews`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, analysisId: current.analysisId, ...extra }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save review.");
      if (data.type === "event") {
        setStored((previous) => {
          const old = previous[current.analysisId!] ?? { analysisId: current.analysisId!, reflection: blank, events: [] };
          return { ...previous, [current.analysisId!]: { ...old, events: [...old.events, data.event] } };
        });
      }
      if (data.type === "reflection") {
        setStored((previous) => {
          const old = previous[current.analysisId!] ?? { analysisId: current.analysisId!, reflection: blank, events: [] };
          return { ...previous, [current.analysisId!]: { ...old, reflection: data.reflection } };
        });
        setStatus("Reflection saved.");
      }
      return data;
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save review."); return null; }
    finally { setBusy(false); }
  }

  function drop(from: string, to: string) {
    if (revealed || busy || !current) return false;
    try {
      const chess = new Chess(position);
      const result = chess.move({ from, to, promotion: "q" });
      setMove(result.san); setCandidateFen(chess.fen()); setStatus("");
      return true;
    } catch { return false; }
  }

  async function submit() {
    if (!move || !current) return;
    const data = await save("submit", { move });
    if (!data) return;
    setCandidateFen(null); setRevealed(true); setContinuationPly(0);
    const message = data.event.matchedBest === true
      ? data.firstAttempt ? "Your move matches the saved top recommendation on the first submission." : "Your move matches the saved top recommendation."
      : data.event.matchedBest === false
        ? "Your move differs from the saved top recommendation. This search does not establish that your move is bad."
        : "Move recorded. No saved engine recommendation is available for comparison.";
    setFeedback({ submittedSan: data.event.submittedSan, matchedBest: data.event.matchedBest, message });
  }

  async function requestHint() {
    if (!current || hint || busy) return;
    const result = await save("hint");
    if (result) setHint(getReviewHint(position, current.alternative));
  }

  async function reveal() {
    if (!current || busy) return;
    const result = await save("reveal");
    if (result) { setCandidateFen(null); setRevealed(true); setContinuationPly(0); setFeedback({ message: "Answer revealed. This position is recorded as a reveal, not a successful solve." }); }
  }

  async function saveNotes() {
    const result = await save("save-reflection", { reflection });
    if (result) setReflectionDirty(false);
  }
  async function saveReflectionBeforeLeaving() {
    if (!reflectionDirty) return true;
    const result = await save("save-reflection", { reflection });
    if (!result) return false;
    setReflectionDirty(false);
    return true;
  }
  async function navigateWithSave(nextIndex: number) {
    if (busy) return;
    if (await saveReflectionBeforeLeaving()) navigate(nextIndex);
  }
  async function exitWithSave() {
    if (busy) return;
    if (await saveReflectionBeforeLeaving()) onExit();
  }
  async function changeFilter(value: ReviewColor) {
    if (busy) return;
    if (!await saveReflectionBeforeLeaving()) return;
    setColor(value); setIndex(0); setFinished(false);
  }
  async function finish() {
    if (busy) return;
    if (await saveReflectionBeforeLeaving()) setFinished(true);
  }

  const engineEvaluation = typeof current?.before === "number" ? `${current.before > 0 ? "+" : ""}${current.before.toFixed(2)} → ${typeof current.after === "number" ? `${current.after > 0 ? "+" : ""}${current.after.toFixed(2)}` : "unavailable"}${current.engine ? ` · ${current.engine}` : ""}${current.depth ? ` depth ${current.depth}` : ""}` : "Unavailable in saved compatible analysis";
  const moverName = moverColor === "white" ? "White" : "Black";

  return <section className="mx-auto flex min-h-[min(82vh,900px)] max-h-[calc(100dvh-140px)] w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#10121a] shadow-[0_24px_80px_rgba(0,0,0,0.3)]" aria-label="Mistake review workspace">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3 sm:px-6">
      <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b19cff]">Post-game lesson</p><h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">Review My Mistakes</h2><p className="mt-1 truncate text-xs text-gray-400">{openingName || "Opening unavailable"} · {candidates.length ? `${progress} of ${candidates.length} positions` : "No reviewable positions"}</p></div>
      <div className="flex items-center gap-2"><label className="hidden items-center gap-2 text-xs text-gray-400 sm:flex">Review<select aria-label="Moves to review" className="rounded-lg border border-white/10 bg-[#0b0d13] px-2.5 py-2 text-xs text-white" value={color} onChange={(event) => void changeFilter(event.target.value as ReviewColor)}><option value="both">Both players</option>{playerColor && <option value="mine">My moves</option>}<option value="white">White</option><option value="black">Black</option></select></label><button className="rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-300 transition hover:bg-white/[0.06]" onClick={() => void exitWithSave()}>Exit Review</button></div>
    </header>

    <div className="border-b border-white/[0.06] px-4 py-2 sm:hidden"><label className="flex items-center justify-between gap-2 text-xs text-gray-400">Reviewing<select aria-label="Moves to review" className="rounded-lg border border-white/10 bg-[#0b0d13] px-2.5 py-2 text-xs text-white" value={color} onChange={(event) => void changeFilter(event.target.value as ReviewColor)}><option value="both">Both players</option>{playerColor && <option value="mine">My moves</option>}<option value="white">White</option><option value="black">Black</option></select></label></div>

    {finished ? <div className="flex flex-1 items-center justify-center p-5 sm:p-10"><div className="w-full max-w-2xl rounded-2xl border border-[#a58aff]/20 bg-[#151320] p-5 sm:p-8"><p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b19cff]">Session complete</p><h3 className="mt-2 text-2xl font-semibold">Review session summary</h3><p className="mt-2 text-sm text-gray-400">These totals reflect events saved during this session.</p><div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">{[["Positions", sessionSummary.positions], ["Submissions", sessionSummary.submissions], ["Top matches", sessionSummary.firstMatches], ["Hints", sessionSummary.hints], ["Reveals", sessionSummary.reveals]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/[0.07] bg-black/15 p-3"><p className="text-[10px] uppercase tracking-wide text-gray-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{value}</p></div>)}</div><p className="mt-4 text-sm text-gray-300">First-submission matches: <strong>{unaidedAccuracy === null ? "No submissions yet" : `${unaidedAccuracy}%`}</strong></p><button className="mt-6 rounded-lg bg-[#7655dc]/30 px-4 py-2.5 text-sm font-medium hover:bg-[#7655dc]/40" onClick={onExit}>Return to game analysis</button></div></div> : !current ? <div className="flex flex-1 items-center justify-center p-8 text-center"><div><p className="text-lg font-medium">No compatible review positions</p><p className="mx-auto mt-2 max-w-md text-sm text-gray-400">This selection has no saved, compatible classified positions. Analyze the game at a consistent depth or choose another player filter.</p><button className="mt-5 rounded-lg border border-white/10 px-4 py-2 text-sm" onClick={onExit}>Return to analysis</button></div></div> : <>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3 sm:px-6">
        <div><p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Find a better move</p><p className="mt-0.5 text-base font-semibold sm:text-lg">Move {current.moveNumber}{moverColor === "white" ? "." : "…"} · {moverName} to move</p></div>
        <div className="flex items-center gap-2"><span className="hidden text-xs text-gray-500 sm:inline">Board faces {orientation === "white" ? "White" : "Black"}</span><button aria-label="Flip review board" className="rounded-lg border border-white/10 px-3 py-2 text-xs hover:bg-white/[0.06]" onClick={() => setOrientationMode(orientation === "white" ? "black" : "white")}>Flip board</button></div>
      </div>

      <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto xl:grid-cols-[minmax(0,1.12fr)_minmax(350px,0.88fr)]">
        <div className="flex min-w-0 flex-col justify-center border-b border-white/[0.06] p-3 sm:p-5 xl:border-b-0 xl:border-r">
          <div className="mx-auto w-full max-w-[680px]">
            <div className="flex items-stretch gap-2"><div className="flex min-w-0 flex-1 justify-center"><div className="w-full"><Chessboard position={visibleFen} boardOrientation={orientation} onPieceDrop={drop} animationDuration={180} areArrowsAllowed={false} arePremovesAllowed={false} /></div></div></div>
            <p className="mt-2 text-center text-[11px] text-gray-500">{revealed ? continuationPly ? `Engine line · ${continuationPly} of ${continuation.length} moves` : "Answer visible · saved game position" : `Candidate move · ${moverName} to play`}</p>
          </div>
        </div>

        <div className="flex min-h-0 min-w-0 flex-col p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Your task</p><h3 className="mt-1 text-xl font-semibold">What would you play instead?</h3></div><span className="text-xs tabular-nums text-gray-400">{index + 1} / {candidates.length}</span></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-label="Mistake review progress" aria-valuemin={0} aria-valuemax={candidates.length} aria-valuenow={index + 1}><div className="h-full rounded-full bg-gradient-to-r from-[#7655dc] to-[#b19cff] transition-all duration-300" style={{ width: `${((index + 1) / candidates.length) * 100}%` }} /></div>
          <p className="mt-2 text-xs text-gray-400">Reviewing <strong className="text-gray-200">{moverName}{playerColor ? playerColor === moverColor ? " · your move" : " · opponent move" : " · player to review"}</strong>{openingName ? ` in ${openingName}` : ""}.</p>

          <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/15 p-3"><p className="text-[10px] uppercase tracking-wide text-gray-500">Your candidate</p><p className="mt-1 text-lg font-semibold">{move || "Select a legal move on the board"}</p>{!revealed && <p className="mt-1 text-xs text-gray-500">The saved answer stays hidden until you submit or reveal it.</p>}</div>

          {!revealed ? <>
            <div className="mt-4 flex flex-wrap gap-2"><button className="flex-1 rounded-lg bg-[#7655dc]/35 px-4 py-3 text-sm font-semibold transition hover:bg-[#7655dc]/45 disabled:cursor-not-allowed disabled:opacity-40" disabled={!move || busy} onClick={submit}>{busy ? "Saving…" : "Submit Move"}</button><button className="rounded-lg border border-white/10 px-3 py-3 text-sm hover:bg-white/[0.05]" disabled={busy || Boolean(hint)} onClick={requestHint}>Show Hint</button><button className="rounded-lg border border-amber-300/20 px-3 py-3 text-sm text-amber-100 hover:bg-amber-300/[0.06]" disabled={busy} onClick={reveal}>Reveal Answer</button></div>
            {move && <button className="mt-2 self-start text-xs text-gray-500 underline decoration-white/20 underline-offset-2" onClick={() => { setMove(""); setCandidateFen(null); }}>Clear candidate move</button>}
            {hint && <p className="mt-3 rounded-lg border border-[#a58aff]/15 bg-[#7655dc]/[0.08] p-3 text-sm text-[#d9ceff]" role="status">Hint · {hint}</p>}
          </> : <>
            <div className="mt-4 rounded-xl border border-[#a58aff]/20 bg-[#7655dc]/[0.07] p-3" aria-live="polite"><p className="text-sm font-medium">{feedback?.message ?? "Answer revealed."}</p><dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs"><div><dt className="text-gray-500">Your move</dt><dd className="mt-0.5 font-semibold text-white">{feedback?.submittedSan ?? move ?? "Not submitted · answer revealed"}</dd></div><div><dt className="text-gray-500">Played in game</dt><dd className="mt-0.5 font-semibold text-white">{current.san}</dd></div><div><dt className="text-gray-500">Saved top recommendation</dt><dd className="mt-0.5 font-semibold text-[#d4c9ff]">{current.alternative ?? "Unavailable"}</dd></div><div><dt className="text-gray-500">Comparison</dt><dd className="mt-0.5 font-semibold">{feedback?.matchedBest === true ? "Matches top recommendation" : feedback?.matchedBest === false ? "Different · not assessed as bad" : "Not available"}</dd></div></dl><p className="mt-3 border-t border-white/[0.08] pt-2 text-xs text-gray-300"><span className="text-gray-500">Saved evaluations · White perspective:</span> {engineEvaluation}{typeof current.loss === "number" ? ` · ${current.loss.toFixed(2)} pawn loss for ${moverName}` : ""}</p></div>
            <div className="mt-3 rounded-xl border border-white/[0.07] p-3"><div className="flex items-center justify-between gap-2"><p className="text-[10px] uppercase tracking-wide text-gray-500">Saved engine continuation</p><p className="text-[10px] text-gray-500">{continuation.length ? `${continuationPly}/${continuation.length}` : "Unavailable"}</p></div><p className="mt-1 text-sm leading-6 text-gray-200">{continuation.length ? continuation.map((san, ply) => <span key={`${ply}-${san}`} className={ply < continuationPly ? "text-[#c7b8ff]" : "text-gray-500"}>{san}{ply < continuation.length - 1 ? " " : ""}</span>) : "No principal variation was saved for this position."}</p>{continuation.length > 0 && <div className="mt-2 flex gap-2"><button className="rounded-lg border border-white/10 px-3 py-2 text-xs disabled:opacity-40" disabled={continuationPly === 0 || busy} onClick={() => setContinuationPly((value) => Math.max(0, value - 1))}>Previous line move</button><button className="rounded-lg border border-[#a58aff]/20 px-3 py-2 text-xs text-[#d8ceff] disabled:opacity-40" disabled={continuationPly >= continuation.length || busy} onClick={() => setContinuationPly((value) => Math.min(continuation.length, value + 1))}>Play next line move</button></div>}</div>
          </>}

          {status && <p role="status" className={`mt-3 text-xs ${status.includes("saved") ? "text-emerald-300" : "text-rose-300"}`}>{status}</p>}
          <details className="mt-4 rounded-xl border border-white/[0.07] bg-black/10"><summary className="cursor-pointer px-3 py-3 text-sm font-medium text-gray-200">Personal reflection <span className="ml-1 text-xs font-normal text-gray-500">{reflectionDirty ? "· unsaved changes" : currentStored?.reflection && Object.values(currentStored.reflection).some(Boolean) ? "· saved notes" : "· optional"}</span></summary><div className="grid gap-3 border-t border-white/[0.06] p-3 sm:grid-cols-2">{prompts.map(({ key, label }) => <label key={key} className="text-xs leading-5 text-gray-400">{label}<textarea className="field mt-1.5 min-h-20 w-full resize-y text-sm" value={reflection[key]} onChange={(event) => { setReflection((old) => ({ ...old, [key]: event.target.value })); setReflectionDirty(true); }} /></label>)}<button className="rounded-lg border border-[#a58aff]/20 px-3 py-2 text-sm text-[#ded5ff] hover:bg-[#7655dc]/10 sm:col-span-2" disabled={busy} onClick={saveNotes}>{busy ? "Saving…" : "Save reflection"}</button></div></details>

          {events.length > 0 && <details className="mt-3 rounded-xl border border-white/[0.07] px-3"><summary className="cursor-pointer py-3 text-xs text-gray-400">Saved position history · {events.length} events</summary><ul className="space-y-2 border-t border-white/[0.06] py-3 text-xs text-gray-400">{events.map((event) => <li key={event.id}>{new Date(event.createdAt).toLocaleString()} · {event.kind === "reveal" ? "Answer revealed" : event.kind === "hint" ? "Hint requested" : `Submitted ${event.submittedSan}${event.matchedBest === true ? " · matched recommendation" : event.matchedBest === false ? " · differed; quality not assessed" : ""}`}</li>)}</ul></details>}
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3 sm:px-6"><button className="rounded-lg border border-white/10 px-3 py-2.5 text-sm disabled:opacity-35" disabled={index === 0 || busy} onClick={() => void navigateWithSave(index - 1)}>← Previous Mistake</button><p className="text-xs text-gray-500">← / → navigate · Esc exit · no shortcut reveals an answer</p>{index < candidates.length - 1 ? <button className="rounded-lg border border-white/10 px-3 py-2.5 text-sm disabled:opacity-35" disabled={busy} onClick={() => void navigateWithSave(index + 1)}>Next Mistake →</button> : <button className="rounded-lg bg-[#7655dc]/25 px-3 py-2.5 text-sm font-medium hover:bg-[#7655dc]/35" disabled={busy} onClick={() => void finish()}>Finish Review</button>}</footer>
    </>}
  </section>;
}
