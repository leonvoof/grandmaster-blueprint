"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { SyncCounts } from "@/lib/lichess";

const fieldClass = "rounded-lg border border-white/15 bg-[#0b0d13] px-3 py-2 text-sm";
const buttonClass = "rounded-lg bg-[#7655dc] px-3 py-2 text-sm font-medium text-white hover:bg-[#8668e9] disabled:opacity-50";
const speeds = ["classical", "rapid", "blitz"] as const;
const labels = { classical: "Classical", rapid: "Rapid", blitz: "Blitz" };
type Settings = { username: string; classical: number | null; rapid: number | null; blitz: number | null };
type SyncUpdate = SyncCounts & { done?: boolean; error?: string; retryAfter?: number };

function errorText(data: { error?: string; retryAfter?: number }) {
  if (!data.error) return "";
  return data.retryAfter ? `${data.error} Try again in ${data.retryAfter} seconds.` : data.error;
}

export function LichessSync({ onSynced }: { onSynced: () => void }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [username, setUsername] = useState("");
  const [speed, setSpeed] = useState<typeof speeds[number]>("classical");
  const [limit, setLimit] = useState(50);
  const [action, setAction] = useState<"loading" | "connect" | "sync" | null>("loading");
  const [error, setError] = useState("");
  const [summary, setSummary] = useState<SyncUpdate | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/lichess", { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(errorText(data));
        setSettings(data.settings);
        setUsername(data.settings?.username ?? "");
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load Lichess settings.");
      } finally {
        if (!controller.signal.aborted) setAction(null);
      }
    }
    void load();
    return () => controller.abort();
  }, []);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAction("connect");
    setError("");
    setSummary(null);
    try {
      const response = await fetch("/api/lichess", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(errorText(data));
      setSettings(data.settings);
      setUsername(data.settings.username);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not connect to Lichess.");
    } finally {
      setAction(null);
    }
  }

  async function sync() {
    setAction("sync");
    setError("");
    setSummary({ imported: 0, skipped: 0, failed: 0 });
    try {
      const response = await fetch("/api/lichess", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ speed, limit }),
      });
      if (!response.ok) throw new Error(errorText(await response.json()));
      if (!response.body) throw new Error("Could not read sync progress.");
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let pending = "";
      let finished = false;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          const lines = (pending + value).split("\n");
          pending = lines.pop() ?? "";
          for (const line of lines) {
            const update: SyncUpdate = JSON.parse(line);
            setSummary(update);
            if (update.done) {
              finished = true;
              setError(errorText(update));
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
      if (!finished) throw new Error("Sync was interrupted. Games already imported are saved.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sync games.");
    } finally {
      setAction(null);
      onSynced();
    }
  }

  const dirty = username.trim().toLowerCase() !== settings?.username.toLowerCase();
  return (
    <section className="rounded-xl border border-white/10 bg-[#11131b] p-5" aria-labelledby="lichess-title">
      <h2 id="lichess-title" className="text-lg font-medium">Lichess settings</h2>
      <form onSubmit={connect} className="mt-3 flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          Lichess username
          <input className={`${fieldClass} mt-1 block w-full`} value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={30} disabled={action !== null} />
        </label>
        <button className={buttonClass} disabled={action !== null}>{action === "connect" ? "Checking…" : dirty ? "Save username" : "Refresh ratings"}</button>
      </form>
      {settings && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {speeds.map((item) => <div key={item}><dt className="text-gray-400">{labels[item]}</dt><dd>{settings[item] ?? "Unavailable"}</dd></div>)}
        </dl>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-2 text-sm">
        <label>Speed
          <select className={`${fieldClass} mt-1 block w-full`} value={speed} onChange={(event) => setSpeed(speeds.find((item) => item === event.target.value) ?? "classical")} disabled={action !== null}>
            {speeds.map((item) => <option key={item} value={item}>{labels[item]}</option>)}
          </select>
        </label>
        <label>Game limit
          <select className={`${fieldClass} mt-1 block w-full`} value={limit} onChange={(event) => setLimit(Number(event.target.value))} disabled={action !== null}>
            {[10, 25, 50, 100].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <button className={buttonClass} disabled={action !== null || !settings || dirty} onClick={sync}>Sync Games</button>
      </div>
      <p className="mt-3 text-sm text-gray-400" role="status">
        {action === "loading" && "Loading settings…"}
        {action === "sync" && "Syncing… "}
        {summary && `${summary.imported} imported · ${summary.skipped} skipped · ${summary.failed} failed`}
        {summary?.done && !summary.error && !summary.imported && !summary.skipped && !summary.failed && " · No public completed games found for this speed."}
      </p>
      {error && <p className="mt-2 text-sm text-red-300" role="alert">{error}</p>}
    </section>
  );
}
