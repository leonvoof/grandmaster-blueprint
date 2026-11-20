"use client";

import { Chess } from "chess.js";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, FlipVertical, Plus, SkipBack, SkipForward } from "lucide-react";
import { PublicBoard, type BoardMove } from "@/components/public-board";
import { PublicOpeningLibrary, type LibraryImport } from "@/components/public-opening-library";
import { loadOpeningLibrary, type OpeningLibrary } from "@/lib/built-in-openings";
import { PublicOpeningPractice } from "@/components/public-opening-practice";
import type { PublicProgress } from "@/lib/public-progress";
import { addRepertoireMove, maxRepertoires, mergeRepertoireLines, repertoirePositions, repertoireRoot, type PublicRepertoire } from "@/lib/public-repertoire";

type Update = (change: (progress: PublicProgress) => PublicProgress) => boolean;
const card = "min-w-0 rounded-2xl border border-white/10 bg-[#111815] p-4 sm:p-5";
const control = "rounded-lg border border-white/10 px-3 py-2 text-sm text-[#d4e4dc] hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#70d6b8] disabled:opacity-35";
const field = "w-full min-w-0 rounded-lg border border-white/15 bg-[#0a0e0d] px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#70d6b8]";

export function PublicOpeningEditor({ repertoires, update }: { repertoires?: PublicRepertoire[]; update: Update }) {
  const [selectedId, setSelectedId] = useState<string>();
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState<OpeningLibrary>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [importError, setImportError] = useState("");
  const [practiceId, setPracticeId] = useState<string>();
  const [name, setName] = useState("");
  const [color, setColor] = useState<PublicRepertoire["color"]>("white");
  const selected = repertoires?.find((item) => item.id === selectedId) ?? repertoires?.[0];
  const needsLibrary = showLibrary || Boolean(selected?.moves.length);
  useEffect(() => {
    if (!needsLibrary || library || loadFailed) return;
    let active = true;
    void loadOpeningLibrary().then(
      (data) => { if (active) setLibrary(data); },
      () => { if (active) setLoadFailed(true); },
    );
    return () => { active = false; };
  }, [needsLibrary, library, loadFailed]);

  function importOpening({ lines, name, color, target, practice }: LibraryImport) {
    setImportError("");
    const id = target || crypto.randomUUID();
    let error = "";
    const saved = update((previous) => {
      try {
        const destination = target ? previous.repertoires.find((item) => item.id === target && item.color === color) : undefined;
        if (target && !destination) throw new Error("This destination is unavailable. Choose another repertoire.");
        if (!destination && previous.repertoires.length >= maxRepertoires) throw new Error("The repertoire library is full. Choose an existing repertoire.");
        const repertoire = mergeRepertoireLines(destination ?? { id, name: name.slice(0, 100), color, moves: [] }, lines, () => crypto.randomUUID());
        return {
          ...previous,
          repertoires: destination ? previous.repertoires.map((item) => item.id === id ? repertoire : item) : [...previous.repertoires, repertoire],
        };
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "Could not import the selected lines.";
        throw cause;
      }
    });
    if (!saved) {
      setImportError(error || "Could not save the repertoire in this browser.");
      return;
    }
    setSelectedId(id);
    if (practice) {
      setShowLibrary(false);
      setPracticeId(id);
    }
    return id;
  }

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    const repertoire: PublicRepertoire = { id: crypto.randomUUID(), name: name.trim(), color, moves: [] };
    if (update((previous) => ({ ...previous, repertoires: [...previous.repertoires, repertoire] }))) {
      setSelectedId(repertoire.id);
      setName("");
    }
  }

  const practice = repertoires?.find((item) => item.id === practiceId && item.moves.length > 0);
  return <>
    {practice && <PublicOpeningPractice key={practice.id} repertoire={practice} onExit={() => setPracticeId(undefined)} />}
    {!practice && <div className="mb-3 flex flex-wrap gap-2" aria-label="Opening Academy views">
      <button className={`${control} aria-pressed:bg-[#70d6b8]/10 aria-pressed:text-[#a8eed8]`} aria-pressed={!showLibrary} onClick={() => setShowLibrary(false)}>My Repertoire</button>
      <button className={`${control} aria-pressed:bg-[#70d6b8]/10 aria-pressed:text-[#a8eed8]`} aria-pressed={showLibrary} onClick={() => setShowLibrary(true)}>Built-in Openings</button>
    </div>}
    {showLibrary && !practice && <section className={card}>
      <h2 className="font-semibold">Built-in Openings</h2>
      <p className="mb-4 mt-1 text-sm text-[#a4b5ab]">Recorded opening lines from the Lichess Chess Openings dataset (CC0).</p>
      {library ? <PublicOpeningLibrary library={library} repertoires={repertoires} onImport={importOpening} /> :
        loadFailed ? <div role="status" className="flex flex-wrap items-center gap-2 text-sm"><p>Could not load the opening library.</p><button className={control} onClick={() => setLoadFailed(false)}>Retry</button></div> :
          <p role="status" className="text-sm text-[#a4b5ab]">Loading opening library…</p>}
      {importError && <p role="alert" className="mt-3 text-sm text-[#f5b0a5]">{importError}</p>}
    </section>}
    <div className={practice || showLibrary ? "hidden" : "grid items-start gap-4 xl:grid-cols-[245px_minmax(0,1fr)]"}>
    <aside className={card}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold"><BookOpen size={17} className="text-[#70d6b8]" /> Repertoires</h2>
      {(["white", "black"] as const).map((side) => <section key={side} className="mb-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-[#9dadA5]">{side}</h3>
        {repertoires?.filter((item) => item.color === side).map((item) => <div key={item.id} className="mb-1 flex gap-1">
          <button type="button" onClick={() => setSelectedId(item.id)}
          aria-pressed={item.id === selected?.id} className={`${control} min-w-0 flex-1 break-words text-left aria-pressed:border-[#70d6b8]/35 aria-pressed:bg-[#70d6b8]/10 aria-pressed:text-[#a8eed8]`}>{item.name}</button>
          <button className={control} disabled={!item.moves.length} title={!item.moves.length ? "Add a move before practicing" : undefined}
            aria-label={`Practice ${item.name}`} onClick={() => { setSelectedId(item.id); setPracticeId(item.id); }}>Practice</button>
        </div>)}
        {!repertoires?.some((item) => item.color === side) && <p className="text-sm text-[#92a49a]">{repertoires ? "No repertoires yet." : "Loading…"}</p>}
      </section>)}
      <form onSubmit={create} className="space-y-2 border-t border-white/10 pt-4">
        <label className="block text-sm" htmlFor="repertoire-name">New repertoire</label>
        <input className={field} id="repertoire-name" placeholder="Repertoire name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} required />
        <select aria-label="Repertoire color" className={field} value={color} onChange={(event) => setColor(event.target.value === "white" ? "white" : "black")}>
          <option value="white">White</option><option value="black">Black</option>
        </select>
        <button className={`${control} flex w-full items-center justify-center gap-2 bg-[#70d6b8]/10 text-[#a8eed8]`} disabled={!repertoires || repertoires.length >= maxRepertoires || !name.trim()}><Plus size={16} /> Create repertoire</button>
      </form>
    </aside>
    {selected ? <RepertoireBoard key={selected.id} repertoire={selected} update={update} library={library} /> :
      <section className={`${card} py-12 text-center`}>
        <h2 className="font-semibold">{repertoires ? "Build your first repertoire" : "Loading your repertoire library"}</h2>
        {repertoires && <p className="mt-2 text-sm text-[#a4b5ab]">Choose a side and name your repertoire to start adding moves.</p>}
      </section>}
    </div>
  </>;
}

function RepertoireBoard({ repertoire, update, library }: { repertoire: PublicRepertoire; update: Update; library?: OpeningLibrary }) {
  const [selectedId, setSelectedId] = useState(repertoireRoot);
  const [preferred, setPreferred] = useState<Map<string, string>>(() => new Map());
  const [black, setBlack] = useState(repertoire.color === "black");
  const [rename, setRename] = useState<string | null>(null);
  const positions = useMemo(() => repertoirePositions(repertoire.moves), [repertoire.moves]);
  const current = positions.get(selectedId) ?? positions.get(repertoireRoot)!;
  const recognized = useMemo(() => {
    if (!library) return [];
    const path = [];
    for (let node = positions.get(current.id); node?.move; node = positions.get(node.parent!)) {
      const { from, to, promotion } = node.move;
      path.push(from + to + (promotion ?? ""));
    }
    return library.recognize(path.reverse());
  }, [library, positions, current.id]);
  function select(id: string) {
    const path = new Map(preferred);
    for (let node = positions.get(id); node?.parent; node = positions.get(node.parent)) {
      path.set(node.parent, node.id);
    }
    setPreferred(path);
    setSelectedId(id);
  }
  function next(id: string) {
    const children = positions.get(id)!.children;
    const choice = preferred.get(id);
    return choice && children.includes(choice) ? choice : children[0];
  }
  let end = current.id;
  for (let child = next(end); child; child = next(end)) end = child;
  function move(input: BoardMove) {
    const id = crypto.randomUUID();
    let destination = id;
    try {
      new Chess(current.fen).move(input);
    } catch { return false; }
    const saved = update((previous) => {
      if (!previous.repertoires.some(({ id }) => id === repertoire.id)) throw new Error("Repertoire was removed.");
      return { ...previous, repertoires: previous.repertoires.map((item) => {
        if (item.id !== repertoire.id) return item;
        const result = addRepertoireMove(item, current.id, input, id);
        destination = result.id;
        return result.repertoire;
      }) };
    });
    if (!saved) return false;
    setPreferred(new Map(preferred).set(current.id, destination));
    setSelectedId(destination);
    return true;
  }
  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!rename?.trim()) return;
    if (update((previous) => ({ ...previous, repertoires: previous.repertoires.map((item) => item.id === repertoire.id ? { ...item, name: rename.trim() } : item) }))) setRename(null);
  }
  function remove() {
    if (window.confirm(`Delete “${repertoire.name}” and all its moves from this browser?`)) {
      update((previous) => ({ ...previous, repertoires: previous.repertoires.filter((item) => item.id !== repertoire.id) }));
    }
  }
  const treeRows = [];
  const pending = [{ id: repertoireRoot, indent: 0 }];
  while (pending.length) {
    const { id, indent } = pending.pop()!;
    const node = positions.get(id)!;
    treeRows.push({ ...node, indent });
    node.children.slice().reverse().forEach((child) => pending.push({ id: child, indent: id === repertoireRoot ? 0 : indent + Number(node.children.length > 1) }));
  }

  return <section className={card}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><p className="text-xs font-medium capitalize text-[#82ceb7]">{repertoire.color} repertoire</p>
        <h2 className="break-words text-xl font-semibold">{repertoire.name}</h2>
        {recognized.length > 0 && <p className="mt-1 break-words text-xs text-[#a4b5ab]">{recognized.map(({ eco, name }) => `${eco} · ${name}`).join(" / ")}</p>}
      </div>
      <div className="flex gap-2">
        <button className={control} onClick={() => setRename(repertoire.name)}>Rename</button>
        <button className={`${control} text-[#f5b0a5]`} onClick={remove}>Delete</button>
      </div>
    </div>
    {rename !== null && <form onSubmit={saveName} className="mb-4 flex flex-wrap gap-2">
      <input aria-label="Rename repertoire" className={`${field} flex-1 basis-40`} value={rename} onChange={(event) => setRename(event.target.value)} maxLength={100} required />
      <button className={control}>Save name</button>
      <button type="button" className={control} onClick={() => setRename(null)}>Cancel</button>
    </form>}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0">
        <PublicBoard fen={current.fen} black={black} move={move} green />
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button className={control} aria-label="Start" title="Start" disabled={!current.parent} onClick={() => select(repertoireRoot)}><SkipBack size={17} /></button>
          <button className={control} aria-label="Back" title="Back" disabled={!current.parent} onClick={() => current.parent && select(current.parent)}><ArrowLeft size={17} /></button>
          <button className={control} aria-label="Forward" title="Forward" disabled={!next(current.id)} onClick={() => select(next(current.id))}><ArrowRight size={17} /></button>
          <button className={control} aria-label="End" title="End" disabled={end === current.id} onClick={() => select(end)}><SkipForward size={17} /></button>
          <button className={`${control} flex items-center gap-1.5`} onClick={() => setBlack(!black)}><FlipVertical size={16} /> Flip board</button>
        </div>
      </div>
      <div className="min-w-0 rounded-xl border border-white/10 bg-[#0c1210] p-3">
        <h3 className="mb-1 text-sm font-semibold">Move tree</h3>
        <p className="mb-3 text-xs text-[#a4b5ab]">Play a move on the board to save it. Return to an earlier move to add an alternative.</p>
        <ol className="max-h-[26rem] space-y-1 overflow-y-auto" aria-label="Saved moves">
          {treeRows.map(({ id, san, parent, ply, indent }) => <li key={id} style={{ paddingInlineStart: Math.min(indent, 5) * 10 }}>
            <button aria-current={id === current.id ? "step" : undefined} onClick={() => select(id)}
              className={`${control} block w-full text-left aria-[current=step]:border-[#70d6b8]/35 aria-[current=step]:bg-[#70d6b8]/10 aria-[current=step]:text-[#a8eed8]`}>
              {parent ? `${Math.ceil(ply / 2)}${ply % 2 ? "." : "…"} ${san}` : "Starting position"}
            </button>
          </li>)}
        </ol>
      </div>
    </div>
  </section>;
}
