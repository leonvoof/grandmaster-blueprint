"use client";

import { useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import {
  buildTrainingTree, emptyStats, endExercise, playAnswer, requestHint, revealAnswer,
  selectRoot, startExercise, startExerciseAt, trainingPositionAt, type Exercise, type TrainingLine,
} from "@/lib/opening-trainer";
import { makeReviewSavePayload, matchesReviewPosition, postOpeningReview } from "@/lib/opening-training-client";

type Chapter = { id: string; name: string; lines: TrainingLine[] };
type Repertoire = { id: string; name: string; side: string; chapters: Chapter[] };
type SavedPosition = {
  identity: string;
  repertoireId: string;
  chapterId: string;
  trainingColor: "w" | "b";
  startingFen: string;
  fen: string;
  contextPath: string[];
  expectedMoves: string[];
  applicable: boolean;
  nextReviewAt: string | null;
  intervalDays: number;
};
type PendingSave = {
  decisionKey: string;
  positionLocator: { startingFen: string; fen: string; contextPath: string[] };
  payload: {
    repertoireId: string;
    chapterId: string;
    positionId: string;
    trainingColor: "w" | "b";
    idempotencyKey: string;
    submittedMove: string | null;
    incorrectAttempts: number;
    hintsUsed: number;
    answersRevealed: number;
  };
  status: "queued" | "error";
  error?: string;
};
type DuePosition = SavedPosition & { repertoireName: string; chapterName: string };

const pendingStorageKey = "opening-training-pending-reviews-v1";
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;

type TrainerProps = { repertoires: Repertoire[]; onClose: () => void; initialMode?: "normal" | "due"; initialRepertoireId?: string; initialChapterId?: string; initialPositionId?: string };
export function OpeningRecallTrainer({ repertoires, onClose, initialMode = "normal", initialRepertoireId, initialChapterId, initialPositionId }: TrainerProps) {
  const [mode, setMode] = useState<"normal" | "due">(initialMode);
  const [repId, setRepId] = useState(initialRepertoireId ?? repertoires[0]?.id ?? "");
  const [chapterId, setChapterId] = useState(initialChapterId ?? "");
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [message, setMessage] = useState("");
  const [apiPositions, setApiPositions] = useState<SavedPosition[]>([]);
  const [duePositions, setDuePositions] = useState<DuePosition[]>([]);
  const [dueIndex, setDueIndex] = useState(-1);
  const [decisionComplete, setDecisionComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pendingSaves, setPendingSaves] = useState<PendingSave[]>([]);
  const [pendingHydrated, setPendingHydrated] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [dueReviewed, setDueReviewed] = useState(0);
  const [storageWarning, setStorageWarning] = useState("");
  const active = useRef<Exercise | null>(null);
  const tree = useRef<ReturnType<typeof buildTrainingTree> | null>(null);
  const dueTree = useRef<ReturnType<typeof buildTrainingTree> | null>(null);
  const dueItemRef = useRef<DuePosition | null>(null);
  const sendInFlight = useRef(new Set<string>());
  const completedDecisions = useRef(new Set<string>());
  const sessionId = useRef(uuid());
  const occurrence = useRef(0);
  const processingMove = useRef(false);
  const pendingRef = useRef<PendingSave[]>([]);
  const startDueSessionRef = useRef<(filters?: { repertoireId?: string; chapterId?: string; positionId?: string }) => void>(async () => {});

  const repertoire = repertoires.find((item) => item.id === repId);
  const chapter = repertoire?.chapters.find((item) => item.id === chapterId);
  const side = repertoire?.side === "Black" ? "Black" : "White";
  const canPlay = exercise?.status === "player" && !decisionComplete && !busy;
  const dueItem = dueIndex >= 0 ? duePositions[dueIndex] ?? null : null;
  const chaptersForSelection = mode === "due" && !repId
    ? repertoires.flatMap((item) => item.chapters.map((entry) => ({ ...entry, repertoireId: item.id, repertoireName: item.name })))
    : (repertoire?.chapters ?? []).map((entry) => ({ ...entry, repertoireId: repertoire!.id, repertoireName: repertoire!.name }));

  function update(next: Exercise | null) {
    active.current = next;
    setExercise(next);
  }

  useEffect(() => {
    try {
      const restored = JSON.parse(localStorage.getItem(pendingStorageKey) ?? "[]") as PendingSave[];
      pendingRef.current = restored;
      setPendingSaves(restored);
    } catch {
      pendingRef.current = [];
      setStorageWarning("Could not load locally queued review saves; this browser may have storage disabled.");
    }
    setPendingHydrated(true);
  }, []);

  const launchHandled = useRef(false);
  useEffect(() => {
    if (launchHandled.current || initialMode !== "due") return;
    launchHandled.current = true;
    setMode("due");
    setRepId(initialRepertoireId ?? "");
    setChapterId(initialChapterId ?? "");
    startDueSessionRef.current({ repertoireId: initialRepertoireId ?? "", chapterId: initialChapterId ?? "", positionId: initialPositionId });
  }, [initialMode, initialRepertoireId, initialChapterId, initialPositionId]);

  useEffect(() => {
    if (!pendingHydrated) return;
    pendingRef.current = pendingSaves;
    try { localStorage.setItem(pendingStorageKey, JSON.stringify(pendingSaves)); }
    catch { setStorageWarning("Browser storage is unavailable; pending saves will not survive leaving this page."); }
    for (const item of pendingSaves) {
      if (item.status !== "queued" || sendInFlight.current.has(item.payload.idempotencyKey)) continue;
      sendInFlight.current.add(item.payload.idempotencyKey);
      void (async () => {
        try {
          let payload = item.payload;
          if (!payload.positionId) {
            const query = new URLSearchParams({ repertoireId: payload.repertoireId, chapterId: payload.chapterId });
            const lookup = await fetch(`/api/openings/training?${query}`);
            const indexed = await lookup.json().catch(() => null);
            if (!lookup.ok) throw new Error(indexed?.error ?? "Could not refresh the saved position index.");
            const savedPosition = (indexed.positions as SavedPosition[]).find((entry) => entry.applicable
              && entry.trainingColor === payload.trainingColor
              && entry.startingFen === item.positionLocator.startingFen
              && entry.fen === item.positionLocator.fen
              && JSON.stringify(entry.contextPath) === JSON.stringify(item.positionLocator.contextPath));
            if (!savedPosition) throw new Error("This position is no longer present in the saved repertoire.");
            payload = { ...payload, positionId: savedPosition.identity };
            setPendingSaves((current) => current.map((entry) => entry.payload.idempotencyKey === payload.idempotencyKey ? { ...entry, payload } : entry));
          }
          const result = await postOpeningReview(payload);
          setPendingSaves((current) => current.filter((entry) => entry.payload.idempotencyKey !== item.payload.idempotencyKey));
          setSavedCount((count) => count + 1);
          setMessage(result?.duplicate ? "Review already saved; duplicate request safely ignored." : "Position review saved and next review scheduled.");
        } catch (error) {
          const detail = error instanceof Error ? error.message : "Review save failed.";
          setPendingSaves((current) => current.map((entry) => entry.payload.idempotencyKey === item.payload.idempotencyKey ? { ...entry, status: "error", error: detail } : entry));
          setMessage(`Review could not be saved: ${detail}. It remains queued for retry.`);
        } finally {
          sendInFlight.current.delete(item.payload.idempotencyKey);
        }
      })();
      break; // SQLite writes are sent sequentially and remain idempotent on retry.
    }
  }, [pendingSaves, pendingHydrated]);

  useEffect(() => {
    processingMove.current = false;
  }, [exercise?.moves]);

  function resetSelection() {
    update(null);
    tree.current = null;
    dueTree.current = null;
    dueItemRef.current = null;
    setDuePositions([]);
    setDueIndex(-1);
    setDecisionComplete(false);
    setApiPositions([]);
    setMessage("");
  }

  function queueDecision(current: Exercise, submittedMove: string | null) {
    const hasActivity = submittedMove !== null || current.incorrectHere > 0 || current.hintsHere > 0 || current.revealsHere > 0;
    if (!hasActivity) return false;
    const item = dueItemRef.current;
    const currentRepertoireId = item?.repertoireId ?? repId;
    const currentChapterId = item?.chapterId ?? chapterId;
    if (!currentRepertoireId || !currentChapterId) {
      setMessage("This position is missing its repertoire association; the review was kept in memory but could not be queued.");
      return false;
    }
    const color = current.color;
    const indexed = item ?? apiPositions.find((entry) => matchesReviewPosition(entry, {
      trainingColor: color, startingFen: current.root.fen, fen: current.position.fen, contextPath: current.moves,
    }));
    const identity = indexed?.identity ?? "";
    // Include the occurrence number so deliberate re-practice in a later variation is a new review,
    // while processingMove and this completed key suppress duplicate UI events for one decision.
    const decisionKey = `${sessionId.current}:${occurrence.current}:${identity || current.moves.join(" ")}:${current.position.fen}`;
    if (completedDecisions.current.has(decisionKey)) return false;
    completedDecisions.current.add(decisionKey);
    const pending: PendingSave = {
      decisionKey,
      positionLocator: { startingFen: current.root.fen, fen: current.position.fen, contextPath: [...current.moves] },
      payload: makeReviewSavePayload({
        repertoireId: currentRepertoireId, chapterId: currentChapterId, positionId: identity,
        idempotencyKey: uuid(), exercise: current, submittedMove,
      }),
      status: "queued",
    };
    const nextPending = [...pendingRef.current, pending];
    pendingRef.current = nextPending;
    try { localStorage.setItem(pendingStorageKey, JSON.stringify(nextPending)); }
    catch { setStorageWarning("Browser storage is unavailable; pending saves will not survive leaving this page."); }
    setPendingSaves(nextPending);
    if (item) setDueReviewed((count) => count + 1);
    return true;
  }

  function saveInterruptedDecision(current: Exercise | null) {
    if (!current || decisionComplete) return;
    if (current.incorrectHere || current.hintsHere || current.revealsHere) queueDecision(current, current.lastSubmitted);
  }

  function findSavedPosition(current: Exercise) {
    const item = dueItemRef.current;
    return item ?? apiPositions.find((entry) => matchesReviewPosition(entry, {
      trainingColor: current.color, startingFen: current.root.fen, fen: current.position.fen, contextPath: current.moves,
    }));
  }

  async function loadTrainingPositions(targetRep: string, targetChapter: string) {
    const query = new URLSearchParams({ repertoireId: targetRep });
    if (targetChapter) query.set("chapterId", targetChapter);
    const response = await fetch(`/api/openings/training?${query}`);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error ?? "Could not load opening review schedule.");
    setApiPositions(data.positions ?? []);
    return data.positions as SavedPosition[];
  }

  async function startNormal(nextVariation = false) {
    if (!chapter || !repId) return;
    setBusy(true);
    try {
      await loadTrainingPositions(repId, chapter.id);
      const prepared = tree.current ?? buildTrainingTree(chapter.lines);
      tree.current = prepared;
      if (!prepared.roots.length) {
        setMessage("This chapter has no valid saved variations to practice.");
        return;
      }
      saveInterruptedDecision(active.current);
      const previous = active.current?.status === "ended" ? null : active.current;
      const root = previous && !nextVariation ? previous.root : selectRoot(prepared.roots, Math.random, previous?.root);
      dueItemRef.current = null;
      setDecisionComplete(false);
      setMessage(prepared.skipped ? `Skipped ${prepared.skipped} unreadable saved line(s).` : "");
      processingMove.current = false;
      occurrence.current++;
      update(startExercise(root, side === "White" ? "w" : "b", Math.random, previous?.stats));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load opening review data.");
    } finally { setBusy(false); }
  }

  async function startDueSession(filters: { repertoireId?: string; chapterId?: string; positionId?: string } = {}) {
    setBusy(true);
    setMessage("");
    try {
      const targetRepertoireId = filters.repertoireId ?? repId;
      const targetChapterId = filters.chapterId ?? chapterId;
      const selectedRepertoires = repertoires.filter((item) => (!targetRepertoireId || item.id === targetRepertoireId)
        && (!targetChapterId || item.chapters.some((entry) => entry.id === targetChapterId)));
      const responses = await Promise.all(selectedRepertoires.map(async (item) => {
        const query = new URLSearchParams({ repertoireId: item.id });
        if (targetChapterId) query.set("chapterId", targetChapterId);
        const response = await fetch(`/api/openings/training?${query}`);
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error ?? `Could not load reviews for ${item.name}.`);
        const source = filters.positionId ? data.positions as SavedPosition[] : data.due as SavedPosition[];
        return source.filter((position) => !filters.positionId || position.identity === filters.positionId).map((position) => {
          const namedChapter = item.chapters.find((entry) => entry.id === position.chapterId);
          return { ...position, repertoireName: item.name, chapterName: namedChapter?.name ?? "Saved chapter" };
        });
      }));
      const trees = new Map<string, ReturnType<typeof buildTrainingTree>>();
      const candidates = responses.flat();
      const due = candidates.filter((item) => {
        if (!item.applicable) return false;
        const chapter = repertoires.find((entry) => entry.id === item.repertoireId)?.chapters.find((entry) => entry.id === item.chapterId);
        if (!chapter) return false;
        let built = trees.get(chapter.id);
        if (!built) { built = buildTrainingTree(chapter.lines); trees.set(chapter.id, built); }
        const root = built.roots.find((candidate) => candidate.fen === item.startingFen);
        const position = root ? trainingPositionAt(root, item.contextPath, item.fen) : null;
        return Boolean(position?.continuations.size);
      }).sort((a, b) => {
        const historyCount = (item: SavedPosition) => {
          const values = Array.isArray((item as SavedPosition & { recentSuccessHistory?: number[] }).recentSuccessHistory)
            ? (item as SavedPosition & { recentSuccessHistory: number[] }).recentSuccessHistory : [];
          return values.slice(-2).filter((grade) => grade < 3).length;
        };
        const overdueA = a.nextReviewAt && new Date(a.nextReviewAt).getTime() < Date.now() ? 1 : 0;
        const overdueB = b.nextReviewAt && new Date(b.nextReviewAt).getTime() < Date.now() ? 1 : 0;
        return overdueB - overdueA || historyCount(b) - historyCount(a) || (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? "");
      });
      setDuePositions(due);
      setApiPositions(due);
      setDueReviewed(0);
      setDueIndex(due.length ? 0 : -1);
      tree.current = null;
      dueTree.current = null;
      if (!due.length) {
        dueItemRef.current = null;
        update(null);
        setMessage(candidates.length ? "Saved due positions no longer match the current repertoire and were excluded. Refresh the schedule after updating your repertoire." : "No opening reviews are due today. New positions are available through Practice Opening.");
        return;
      }
      const previousStats = active.current?.status === "ended" ? emptyStats : active.current?.stats;
      openDuePosition(due, 0, previousStats);
      if (due.length < candidates.length) setMessage(`${candidates.length - due.length} stale due position(s) were excluded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load due opening reviews.");
    } finally { setBusy(false); }
  }
  startDueSessionRef.current = (filters) => { void startDueSession(filters); };

  function openDuePosition(items: DuePosition[], index: number, stats?: Exercise["stats"]) {
    const item = items[index];
    if (!item) {
      dueItemRef.current = null;
      setDecisionComplete(false);
      update(active.current ? endExercise(active.current) : null);
      return;
    }
    const selectedRepertoire = repertoires.find((entry) => entry.id === item.repertoireId);
    const selectedChapter = selectedRepertoire?.chapters.find((entry) => entry.id === item.chapterId);
    if (!selectedChapter) {
      setMessage("A scheduled opening position belongs to a chapter that is no longer available.");
      setDecisionComplete(true);
      return;
    }
    const built = buildTrainingTree(selectedChapter.lines);
    const root = built.roots.find((candidate) => candidate.fen === item.startingFen);
    const position = root ? trainingPositionAt(root, item.contextPath, item.fen) : null;
    if (!root || !position || !position.continuations.size) {
      setMessage("This saved review position is stale. Refreshing the schedule will mark it inactive.");
      setDecisionComplete(true);
      return;
    }
    dueTree.current = built;
    dueItemRef.current = item;
    setDueIndex(index);
    occurrence.current++;
    setDecisionComplete(false);
    processingMove.current = false;
    setMessage("");
    update(startExerciseAt(root, position, item.trainingColor, Math.random, item.contextPath, stats));
  }

  function nextDuePosition() {
    const current = active.current;
    if (!decisionComplete) saveInterruptedDecision(current);
    setDecisionComplete(false);
    openDuePosition(duePositions, dueIndex + 1, current?.stats);
  }

  function play(from: string, to: string, promotion?: string) {
    const current = active.current;
    if (!current || current.moves !== exercise?.moves || processingMove.current || !canPlay) return false;
    processingMove.current = true;
    const result = playAnswer(current, { from, to, promotion }, Math.random);
    update(result.state);
    if (result.accepted) {
      const submittedMove = `${from}${to}${promotion ?? ""}`;
      const saved = findSavedPosition(current);
      if (!saved && mode === "normal") setMessage("Saved position index is not current; the API will validate this decision before saving.");
      queueDecision(current, submittedMove);
      if (mode === "due") setDecisionComplete(true);
    } else {
      processingMove.current = false;
    }
    return result.accepted;
  }

  function changeMode(next: "normal" | "due") {
    saveInterruptedDecision(active.current);
    resetSelection();
    setMode(next);
    if (next === "due") { setRepId(""); setChapterId(""); }
    else { setRepId(repertoires[0]?.id ?? ""); setChapterId(""); }
  }

  const unmountDecision = useRef<() => void>(() => {});
  unmountDecision.current = () => saveInterruptedDecision(active.current);
  useEffect(() => () => unmountDecision.current(), []);

  const sessionFinished = mode === "due" && exercise?.status === "ended";
  return <section className="mt-5 rounded-xl border border-purple-400/30 bg-slate-900 p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 className="text-xl">Opening Recall Practice</h2><p className="text-sm text-gray-400">Answers stay hidden until you play or reveal them. Completed decisions are saved to your local review schedule.</p></div>
      <button className="btn" onClick={() => {
        saveInterruptedDecision(active.current);
        if (!exercise || exercise.status === "ended") onClose();
        else { processingMove.current = false; update(endExercise(active.current!)); }
      }}>{exercise?.status === "ended" ? "Close Practice" : "End Session"}</button>
    </div>

    <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Opening practice mode">
      <button className={`btn ${mode === "normal" ? "border-purple-400" : ""}`} onClick={() => changeMode("normal")}>Practice Opening</button>
      <button className={`btn ${mode === "due" ? "border-purple-400" : ""}`} onClick={() => changeMode("due")}>Review Due Positions</button>
    </div>

    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <select className="field" aria-label="Practice repertoire" value={repId} onChange={(event) => {
        saveInterruptedDecision(active.current);
        setRepId(event.target.value);
        setChapterId("");
        resetSelection();
      }}>
        {mode === "due" && <option value="">All openings</option>}
        {mode === "normal" && <option value="">Choose repertoire</option>}
        {repertoires.map((item) => <option key={item.id} value={item.id}>{item.side}: {item.name}</option>)}
      </select>
      <select className="field" aria-label="Practice chapter" value={chapterId} onChange={(event) => {
        saveInterruptedDecision(active.current);
        setChapterId(event.target.value);
        resetSelection();
      }}>
        <option value="">{mode === "due" ? "All chapters" : "Choose chapter"}</option>
        {chaptersForSelection.map((item) => <option key={`${item.repertoireId}:${item.id}`} value={item.id}>{item.repertoireName}: {item.name}</option>)}
      </select>
    </div>

    {mode === "normal" && <>
      <p className="mt-3 text-sm">Training color: <b>{side}</b>{chapter ? ` · ${chapter.name}` : ""}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn" disabled={!chapterId || busy} onClick={() => void startNormal()}>{busy ? "Loading schedule…" : exercise && exercise.status !== "ended" ? "Restart Exercise" : "Start Exercise"}</button>
        {exercise && exercise.status !== "ended" && <>
          <button className="btn" onClick={() => void startNormal(true)}>Next Variation</button>
        </>}
      </div>
    </>}

    {mode === "due" && <>
      <p className="mt-3 text-sm">Choose one repertoire, a chapter, or <b>All openings</b>. Due positions start at the exact saved decision position.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn" disabled={busy || dueIndex >= 0 && !sessionFinished} onClick={() => void startDueSession()}>{busy ? "Loading due positions…" : "Load Due Reviews"}</button>
        {exercise && exercise.status !== "ended" && <>
          <button className="btn" disabled={!canPlay || !!exercise.hint || !!exercise.revealed} onClick={() => {
            if (active.current) update(requestHint(active.current));
          }}>Show Hint</button>
          <button className="btn" disabled={!canPlay || !!exercise.revealed} onClick={() => {
            if (!active.current) return;
            const revealed = revealAnswer(active.current);
            update(revealed);
            queueDecision(revealed, null);
            setDecisionComplete(true);
          }}>Reveal Move</button>
          <button className="btn" onClick={nextDuePosition}>{decisionComplete ? "Next Due Position" : "Skip to Next Due Position"}</button>
        </>}
      </div>
    </>}

    {mode === "normal" && exercise && exercise.status !== "ended" && <div className="mt-2 flex flex-wrap gap-2">
      <button className="btn" disabled={!canPlay || !!exercise.hint || !!exercise.revealed} onClick={() => {
        if (active.current) update(requestHint(active.current));
      }}>Show Hint</button>
      <button className="btn" disabled={!canPlay || !!exercise.revealed} onClick={() => {
        if (active.current) update(revealAnswer(active.current));
      }}>Reveal Move</button>
    </div>}

    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    {pendingSaves.length > 0 && <div role="status" className="mt-3 rounded border border-amber-400/30 p-3 text-sm">
      <p>{pendingSaves.length} review save{pendingSaves.length === 1 ? "" : "s"} pending. {pendingSaves.some((item) => item.status === "error") ? "A save failed and is retained locally." : "Saving…"}</p>
      {pendingSaves.some((item) => item.status === "error") && <button className="btn mt-2" onClick={() => setPendingSaves((items) => items.map((item) => item.status === "error" ? { ...item, status: "queued", error: undefined } : item))}>Retry failed saves</button>}
    </div>}
    {storageWarning && <p role="alert" className="mt-2 text-xs text-amber-300">{storageWarning}</p>}
    {savedCount > 0 && <p className="mt-2 text-xs text-emerald-300">Saved {savedCount} position review{savedCount === 1 ? "" : "s"} this session.</p>}

    {mode === "due" && dueItem && <p className="mt-3 text-sm">Review {dueIndex + 1} of {duePositions.length} · {dueItem.repertoireName} / {dueItem.chapterName} · {dueItem.intervalDays ? `${dueItem.intervalDays}-day interval` : "new review"}</p>}
    {mode === "normal" && exercise && <p className="mt-3 text-sm">Progress: {exercise.moves.length} plies played · {canPlay ? "Your move" : exercise.status === "complete" ? "Variation complete" : "Session ended"}</p>}
    {mode === "due" && exercise && <p className="mt-3 text-sm">{decisionComplete ? "Review decision complete · save pending or saved" : canPlay ? "Your move" : exercise.status === "ended" ? "Due review session complete" : "Preparing saved position"}</p>}

    {((mode === "normal" && exercise && (exercise.status === "complete" || exercise.status === "ended")) || sessionFinished) && <div className="mt-3 rounded border border-white/10 p-3">
      <h3>Session summary</h3>
      {mode === "due" && <p>Due positions reviewed: {dueReviewed} / {duePositions.length}</p>}
      <p>Positions attempted: {exercise.stats.attempted} · Correct first attempts: {exercise.stats.firstCorrect} · Incorrect attempts: {exercise.stats.incorrect} · Hints: {exercise.stats.hints} · Reveals: {exercise.stats.reveals} · {mode === "normal" ? `Variations completed: ${exercise.stats.completed} · ` : ""}Unaided recall accuracy: {exercise.stats.attempted ? `${Math.round(exercise.stats.firstCorrect / exercise.stats.attempted * 100)}%` : "No attempts"}</p>
    </div>}

    {exercise && <>
      <div className="mx-auto mt-3 max-w-[520px]">
        <Chessboard position={exercise.position.fen} boardOrientation={exercise.color === "w" ? "white" : "black"}
          arePiecesDraggable={canPlay} onPieceDrop={(from, to) => play(from, to)}
          onPromotionPieceSelect={(piece, from, to) => !!(piece && from && to && play(from, to, piece[1].toLowerCase()))} />
      </div>
      <div aria-live="polite" className="mt-3 text-sm text-purple-200">
        {exercise.feedback}
        {exercise.hint && <p className="mt-1 text-gray-300">{exercise.hint}</p>}
        {exercise.revealed && <p className="mt-1">Answer: {exercise.revealed}</p>}
      </div>
    </>}
  </section>;
}
