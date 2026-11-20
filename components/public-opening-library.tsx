"use client";

import { useMemo, useState } from "react";
import { type BoardMove } from "@/components/public-board";
import { OpeningExplorerBoard, explorerControl as button, explorerPanel as card } from "@/components/public-opening-explorer-board";
import { type OpeningEntry, type OpeningLibrary } from "@/lib/built-in-openings";
import { catalogExploration } from "@/lib/opening-explorer-session";
import { addExplorationMove, explorationPath, selectExplorationNode, type ExplorationTree } from "@/lib/position-exploration";
import { rememberPath } from "@/lib/public-exploration";
import type { PublicRepertoire } from "@/lib/public-repertoire";

const examples = ["Italian Game", "Ponziani Opening", "Caro-Kann Defense", "Sicilian Defense", "Queen's Gambit"];
const field = "w-full min-w-0 rounded-lg border border-white/15 bg-[#0a0e0d] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[#70d6b8]";
const pageSize = 12;
const maxExploratoryNodes = 4000;
export type LibraryImport = { lines: string[][]; name: string; color: PublicRepertoire["color"]; target: string; practice: boolean };
type Session = ReturnType<typeof catalogExploration> & { preferred: Record<string, string>; played: Set<string>; catalogSize: number };

function newSession(library: OpeningLibrary, entries: readonly OpeningEntry[]): Session {
  const catalog = catalogExploration(library, entries);
  return { ...catalog, preferred: {}, played: new Set(), catalogSize: catalog.tree.nextId };
}

export function PublicOpeningLibrary({ library, repertoires, onImport, active }: {
  library: OpeningLibrary;
  repertoires?: PublicRepertoire[];
  onImport: (input: LibraryImport) => string | undefined;
  active: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [showResults, setShowResults] = useState(false);
  const [family, setFamily] = useState("");
  const [sessions, setSessions] = useState(() => new Map([["", newSession(library, [])]]));
  const [checked, setChecked] = useState<number[]>([]);
  const [saveCurrent, setSaveCurrent] = useState(false);
  const [color, setColor] = useState<PublicRepertoire["color"]>("white");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [moveError, setMoveError] = useState("");
  const matches = useMemo(() => library.search(query), [library, query]);
  const groups = useMemo(() => {
    const groups = new Map<string, OpeningEntry>();
    for (const match of matches) if (!groups.has(match.family)) groups.set(match.family, match);
    return [...groups.values()];
  }, [matches]);
  const session = sessions.get(family)!;
  const variants = library.families.get(family) ?? [];
  const destinations = repertoires?.filter((item) => item.color === color) ?? [];
  const path = explorationPath(session.tree).slice(1).map((node) => node.from! + node.to! + (node.promotion ?? ""));
  const recognized = library.recognize(path).map(({ eco, name }) => `${eco} · ${name}`).join(" / ");
  const importCount = checked.length + Number(saveCurrent && path.length > 0);

  function select(tree: ExplorationTree, id: string, group = family, previous = session, played = false) {
    const preferred = { ...previous.preferred };
    rememberPath(tree, id, preferred);
    const next = { ...previous, tree: selectExplorationNode(tree, id), preferred, played: played ? new Set(previous.played).add(id) : previous.played };
    setSessions((all) => new Map(all).set(group, next));
    setMoveError("");
  }

  function choose(entry: OpeningEntry) {
    const group = entry.family;
    const next = sessions.get(group) ?? newSession(library, library.families.get(group)!);
    select(next.tree, next.endpoints.get(entry.id)!, group, next);
    setFamily(group);
    setChecked([entry.id]);
    setSaveCurrent(false);
    setMessage("");
    setShowResults(false);
  }

  function move({ from, to, promotion }: BoardMove) {
    try {
      const value = promotion === "r" || promotion === "b" || promotion === "n" ? promotion : "q";
      const next = addExplorationMove(session.tree, from, to, value);
      if (next.created && session.tree.nextId - session.catalogSize >= maxExploratoryNodes) {
        setMoveError("This opening session has reached its temporary move limit.");
        return false;
      }
      select(next.tree, next.tree.currentId, family, session, true);
      return true;
    } catch {
      return false;
    }
  }

  function save(practice: boolean) {
    const lines = checked.map((id) => library.line(library.entries[id]));
    if (saveCurrent && path.length) lines.push(path);
    if (!lines.length) return;
    setMessage("");
    const id = onImport({ name: family || "Explored opening", color, target, practice, lines });
    if (id) {
      setTarget(id);
      setMessage(`Saved to My Repertoire · ${lines.length} selected ${lines.length === 1 ? "line" : "lines"}`);
    }
  }

  return <div className="space-y-3">
    <section className={card}>
      <label htmlFor="opening-search" className="block text-sm font-semibold">Search by name or ECO</label>
      <div className="mt-1 flex flex-wrap gap-2">
        <input id="opening-search" className={`${field} flex-1 basis-44`} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); setShowResults(true); }} onFocus={() => setShowResults(true)} />
        <button className={button} aria-expanded={showResults} onClick={() => setShowResults(!showResults)}>{showResults ? "Hide results" : "Browse openings"}</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.filter((name) => library.families.has(name)).map((name) => <button key={name} className={button} aria-pressed={family === name} onClick={() => {
          const group = library.families.get(name)!;
          choose(group.find((entry) => entry.name === name) ?? group[0]);
        }}>{name}</button>)}
        <button className={button} aria-pressed={!family} onClick={() => {
          setFamily(""); setChecked([]); setSaveCurrent(false); setMessage(""); setShowResults(false); setMoveError("");
        }}>Free board</button>
      </div>
      {showResults && <>
        <p className="mt-2 text-xs text-[#a4b5ab]" role="status">{groups.length} opening groups · {matches.length} recorded lines</p>
        <ul className="mt-2 grid max-h-52 gap-1 overflow-y-auto sm:grid-cols-2" aria-label="Opening search results">
          {groups.slice(page * pageSize, (page + 1) * pageSize).map((match) => <li className="min-w-0" key={match.family}>
            <button onClick={() => choose(match)} className={`${button} w-full break-words text-left`}>
              <span className="mr-2 text-xs text-[#82ceb7]">{match.eco}</span>{query.trim() ? match.name : match.family}
            </button>
          </li>)}
        </ul>
        {!groups.length && <p className="text-sm text-[#a4b5ab]">No openings match that search.</p>}
        {groups.length > pageSize && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous results</button>
          <span>{page + 1} / {Math.ceil(groups.length / pageSize)}</span>
          <button className={button} disabled={(page + 1) * pageSize >= groups.length} onClick={() => setPage(page + 1)}>Next results</button>
        </div>}
      </>}
    </section>

    {active && <OpeningExplorerBoard tree={session.tree} preferred={session.preferred} played={session.played.has(session.tree.currentId)}
      recognized={recognized} title={family || "Free board"} onSelect={(id) => select(session.tree, id)} onMove={move} moveError={moveError} />}

    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {variants.length > 0 && <section className={card}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Named variations ({variants.length})</h3>
          <button className={button} onClick={() => setChecked(variants.map(({ id }) => id))}>Select all for import</button>
          <button className={button} onClick={() => setChecked([])}>Clear selection</button>
        </div>
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {variants.map((variant) => {
            const id = session.endpoints.get(variant.id)!;
            return <li key={variant.id} className="flex items-center gap-2">
              <input type="checkbox" aria-label={`Include ${variant.name} (${variant.eco})`} checked={checked.includes(variant.id)}
                onChange={() => setChecked((previous) => previous.includes(variant.id) ? previous.filter((item) => item !== variant.id) : [...previous, variant.id])} />
              <button className={`${button} min-w-0 flex-1 break-words text-left aria-[current=step]:bg-[#70d6b8]/15`}
                aria-current={session.tree.currentId === id ? "step" : undefined} onClick={() => select(session.tree, id)}>
                <span className="mr-2 text-xs text-[#82ceb7]">{variant.eco}</span>{variant.name}
              </button>
            </li>;
          })}
        </ul>
      </section>}
      <section className={card}>
        <h3 className="text-sm font-semibold">Save lines to My Repertoire</h3>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={saveCurrent} disabled={!path.length} onChange={(event) => setSaveCurrent(event.target.checked)} /> Include the current board line
        </label>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span>Practice side</span>
            <select className={field} value={color} onChange={(event) => { setColor(event.target.value === "black" ? "black" : "white"); setTarget(""); }}>
              <option value="white">White</option><option value="black">Black</option>
            </select>
          </label>
          <label className="space-y-1 text-sm"><span>Save to</span>
            <select className={field} value={destinations.some(({ id }) => id === target) ? target : ""} onChange={(event) => setTarget(event.target.value)}>
              <option value="">New repertoire</option>
              {destinations.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`${button} bg-[#70d6b8]/10 text-[#a8eed8]`} disabled={!repertoires || !importCount} onClick={() => save(false)}>Add to My Repertoire ({importCount})</button>
          <button className={button} disabled={!repertoires || !importCount} onClick={() => save(true)}>Add and Practice</button>
        </div>
        {message && <p className="mt-2 text-sm text-[#a8eed8]" role="status">{message}</p>}
      </section>
    </div>
  </div>;
}
