"use client";

import { useMemo, useState } from "react";
import { PublicBoard } from "@/components/public-board";
import { openingPreview, type OpeningEntry, type OpeningLibrary } from "@/lib/built-in-openings";
import type { PublicRepertoire } from "@/lib/public-repertoire";

const examples = ["Italian Game", "Ponziani Opening", "Caro-Kann Defense", "Sicilian Defense", "Queen's Gambit"];
const button = "rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-[#70d6b8]";
const field = "w-full min-w-0 rounded-lg border border-white/15 bg-[#0a0e0d] px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-[#70d6b8]";
const card = "min-w-0 space-y-3 rounded-xl border border-white/10 bg-[#0c1210] p-3 sm:p-4";
const pageSize = 12;
const noMove = () => false;
export type LibraryImport = { lines: string[][]; name: string; color: PublicRepertoire["color"]; target: string; practice: boolean };

export function PublicOpeningLibrary({ library, repertoires, onImport }: {
  library: OpeningLibrary;
  repertoires?: PublicRepertoire[];
  onImport: (input: LibraryImport) => string | undefined;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [family, setFamily] = useState<string>();
  const [entry, setEntry] = useState<OpeningEntry>();
  const [ply, setPly] = useState(0);
  const [checked, setChecked] = useState<number[]>([]);
  const [color, setColor] = useState<PublicRepertoire["color"]>("white");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const matches = useMemo(() => library.search(query), [library, query]);
  const groups = useMemo(() => {
    const groups = new Map<string, OpeningEntry>();
    for (const match of matches) if (!groups.has(match.family)) groups.set(match.family, match);
    return [...groups.values()];
  }, [matches]);
  const preview = useMemo(() => entry ? openingPreview(library, entry) : [], [library, entry]);
  const recognized = entry && ply > 0 ? library.recognize(library.line(entry).slice(0, ply)) : [];
  const variants = family ? library.families.get(family) ?? [] : [];
  const destinations = repertoires?.filter((item) => item.color === color) ?? [];

  function choose(entry: OpeningEntry) {
    setFamily(entry.family);
    setEntry(entry);
    setPly(0);
    setChecked([entry.id]);
    setMessage("");
  }

  function search(query: string) {
    setQuery(query);
    setPage(0);
  }

  function save(practice: boolean) {
    if (!family || !checked.length) return;
    const id = onImport({ name: family, color, target, practice, lines: checked.map((id) => library.line(library.entries[id])) });
    if (id) {
      setTarget(id);
      setMessage(`Saved ${checked.length} selected ${checked.length === 1 ? "line" : "lines"} to My Repertoire.`);
    }
  }

  return <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
    <div className={card}>
      <label htmlFor="opening-search" className="block text-sm font-semibold">Search by name or ECO</label>
      <input id="opening-search" className={field} type="search" value={query} onChange={(event) => search(event.target.value)} />
      <div className="flex flex-wrap gap-1.5">
        {examples.filter((name) => library.families.has(name)).map((name) => <button key={name} className={button} onClick={() => {
          search(name);
          choose(library.families.get(name)![0]);
        }}>{name}</button>)}
      </div>
      <p role="status" className="text-xs text-[#a4b5ab]">{groups.length} opening groups · {matches.length} matching lines</p>
      <ul className="space-y-1" aria-label="Opening search results">
        {groups.slice(page * pageSize, (page + 1) * pageSize).map((match) => <li key={match.family}>
          <button onClick={() => choose(match)} aria-pressed={family === match.family} className={`${button} w-full break-words text-left aria-pressed:bg-[#70d6b8]/10`}>
            <span className="block text-xs text-[#82ceb7]">{match.eco}</span>
            {query.trim() ? match.name : match.family}
          </button>
        </li>)}
      </ul>
      {groups.length === 0 && <p className="text-sm text-[#a4b5ab]">No openings match that search.</p>}
      {groups.length > pageSize && <div className="flex items-center justify-between gap-2 text-xs text-[#a4b5ab]">
        <button className={button} disabled={page === 0} onClick={() => setPage(page - 1)}>Previous results</button>
        <span>{page + 1} / {Math.ceil(groups.length / pageSize)}</span>
        <button className={button} disabled={(page + 1) * pageSize >= groups.length} onClick={() => setPage(page + 1)}>Next results</button>
      </div>}
    </div>
    <div className={card}>
      {entry ? <>
        <h3 className="break-words font-semibold">{entry.name}</h3>
        <p className="text-xs text-[#82ceb7]">ECO {entry.eco} · recorded line</p>
        <PublicBoard id="built-in-opening" fen={preview[ply].fen} black={color === "black"} move={noMove} disabled green />
        <div className="flex flex-wrap items-center gap-2" aria-label="Preview controls">
          <button className={button} disabled={ply === 0} onClick={() => setPly(0)}>Start</button>
          <button className={button} disabled={ply === 0} onClick={() => setPly(ply - 1)}>Back</button>
          <button className={button} disabled={ply === preview.length - 1} onClick={() => setPly(ply + 1)}>Forward</button>
          <button className={button} disabled={ply === preview.length - 1} onClick={() => setPly(preview.length - 1)}>End</button>
          <span className="text-xs text-[#a4b5ab]">{ply ? `${ply} / ${preview.length - 1} · ${preview[ply].san}` : "Starting position"}</span>
        </div>
        {recognized.length > 0 && ply < preview.length - 1 && <p className="text-xs text-[#a4b5ab]">{recognized.map(({ eco, name }) => `${eco} · ${name}`).join(" / ")}</p>}
        <div className="flex flex-wrap gap-1" aria-label="Recorded moves">
          {preview.slice(1).map(({ san }, index) => <button key={index} aria-current={ply === index + 1 ? "step" : undefined} className={`${button} aria-[current=step]:bg-[#70d6b8]/15`} onClick={() => setPly(index + 1)}>
            {Math.floor(index / 2) + 1}{index % 2 ? "…" : "."} {san}
          </button>)}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
          <h4 className="text-sm font-semibold">Named lines ({variants.length})</h4>
          <button className={button} onClick={() => setChecked(variants.map(({ id }) => id))}>Select entire opening</button>
          <button className={button} onClick={() => setChecked([])}>Clear selection</button>
        </div>
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {variants.map((variant) => <li key={variant.id} className="flex items-center gap-2">
            <input type="checkbox" aria-label={`Include ${variant.name} (${variant.eco})`} checked={checked.includes(variant.id)} onChange={() => setChecked((previous) => previous.includes(variant.id) ? previous.filter((id) => id !== variant.id) : [...previous, variant.id])} />
            <button className={`${button} min-w-0 flex-1 break-words text-left aria-pressed:bg-[#70d6b8]/10`} aria-pressed={entry.id === variant.id} onClick={() => { setEntry(variant); setPly(0); }}>
              <span className="mr-2 text-xs text-[#82ceb7]">{variant.eco}</span>{variant.name}
            </button>
          </li>)}
        </ul>
        <div className="grid gap-2 border-t border-white/10 pt-3 sm:grid-cols-2">
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
        <div className="flex flex-wrap gap-2">
          <button className={`${button} bg-[#70d6b8]/10 text-[#a8eed8]`} disabled={!repertoires || !checked.length} onClick={() => save(false)}>Add to My Repertoire ({checked.length})</button>
          <button className={button} disabled={!repertoires || !checked.length} onClick={() => save(true)}>Add and Practice</button>
        </div>
        {message && <p className="text-sm text-[#a8eed8]" role="status">{message}</p>}
      </> : <p className="text-sm text-[#a4b5ab]">Choose an opening to preview its moves and select lines to save.</p>}
    </div>
  </div>;
}
