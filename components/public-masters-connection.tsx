"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  beginMastersAuthorization, exchangeMastersCode, mastersCallback, mastersCallbackFields, mastersTokenExpired,
  mastersTransactionKey, MastersAuthorizationExpired, probeMasters, revokeMastersToken, type MastersConnection,
} from "@/lib/public-lichess-masters-auth";

import { createMastersStatsLoader, type MastersStatsLoader } from "@/lib/public-masters-stats";

const MastersStatsContext = createContext<{ loader: MastersStatsLoader | null; onExpired: () => void }>({ loader: null, onExpired: () => {} });
export const useMastersStatsConnection = () => useContext(MastersStatsContext);

const button = "rounded-lg border border-[#70d6b8]/25 px-3 py-1.5 text-xs text-[#a8eed8] hover:bg-[#70d6b8]/10 focus-visible:outline-2 focus-visible:outline-[#70d6b8] disabled:opacity-50";
const messageFor = (error: unknown) => error instanceof Error ? error.message : "The Lichess connection could not be completed.";

export function PublicMastersConnection({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<MastersConnection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [verified, setVerified] = useState(false);
  const loader = useMemo(() => !busy && connection ? createMastersStatsLoader(connection) : null, [busy, connection]);
  const statsConnection = useMemo(() => ({
    loader,
    onExpired: () => {
      loader?.cancel();
      setConnection(null);
      setVerified(false);
      setMessage("Lichess authorization expired or was rejected. Please connect again.");
    },
  }), [loader]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    // Let React finish any development effect replay before consuming the one-time callback.
    queueMicrotask(async () => {
      if (signal.aborted) return;
      const url = new URL(window.location.href);
      if (!mastersCallbackFields.some((field) => url.searchParams.has(field))) return;
      const cleaned = new URL(url);
      for (const field of mastersCallbackFields) cleaned.searchParams.delete(field);
      window.history.replaceState(null, "", cleaned.pathname + cleaned.search + cleaned.hash);
      setBusy(true);
      try {
        const stored = sessionStorage.getItem(mastersTransactionKey);
        sessionStorage.removeItem(mastersTransactionKey);
        const authorized = await exchangeMastersCode(mastersCallback(url, stored), signal);
        if (signal.aborted) return;
        setConnection(authorized);
        await probeMasters(authorized, signal);
        if (!signal.aborted) setVerified(true);
      } catch (error) {
        if (signal.aborted) return;
        if (error instanceof MastersAuthorizationExpired) setConnection(null);
        setMessage(messageFor(error));
      } finally {
        if (!signal.aborted) setBusy(false);
      }
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!connection) return;
    let timer: number;
    function schedule(active: MastersConnection) {
      if (mastersTokenExpired(active)) {
        statsConnection.onExpired();
      } else {
        timer = window.setTimeout(() => schedule(active), Math.min(active.expiresAt - Date.now(), 2_147_483_647));
      }
    }
    schedule(connection);
    return () => window.clearTimeout(timer);
  }, [connection, statsConnection]);

  async function connect() {
    setBusy(true);
    setMessage("");
    try {
      const { url, transaction } = await beginMastersAuthorization(window.location.origin);
      sessionStorage.setItem(mastersTransactionKey, JSON.stringify(transaction));
      window.location.assign(url);
    } catch {
      setMessage("Could not start Lichess sign-in. Use HTTPS or a local preview with session storage enabled.");
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!connection) return;
    loader?.cancel();
    setConnection(null);
    setVerified(false);
    setBusy(true);
    setMessage("");
    try {
      if (!await revokeMastersToken(connection)) throw new Error();
      setMessage("Lichess disconnected.");
    } catch {
      setMessage("Disconnected in this browser. Lichess could not confirm revocation. Manage access in your Lichess account settings.");
    } finally {
      setBusy(false);
    }
  }

  return <MastersStatsContext.Provider value={statsConnection}><section aria-label="Lichess Masters connection" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0c1210] px-3 py-2">
    <div className="min-w-0">
      <h3 className="text-sm font-semibold">Lichess Masters</h3>
      <p role="status" className="mt-0.5 text-xs text-[#a4b5ab]">
        {message || (busy ? "Checking Lichess access…" : verified ? "Connected · Masters response verified" : connection ? "Connected to Lichess" : "Connect your account to check Masters database access.")}
      </p>
    </div>
    {connection ? <button type="button" className={button} onClick={disconnect} disabled={busy}>Disconnect</button> :
      <button type="button" className={button} onClick={connect} disabled={busy}>Connect Lichess</button>}
  </section>{children}</MastersStatsContext.Provider>;
}
