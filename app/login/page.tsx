"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
export default function LoginPage() {
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(form: FormData) {
    setBusy(true); setError("");
    const result = await signIn("credentials", { username: String(form.get("username") ?? ""), password: String(form.get("password") ?? ""), redirect: false, callbackUrl: String(form.get("callbackUrl") ?? "/") });
    setBusy(false);
    if (result?.error) setError("Sign-in failed. Check your credentials or try again later.");
    else window.location.assign(result?.url ?? "/");
  }
  return <main className="flex min-h-screen items-center justify-center bg-[#090b11] px-4 text-white"><form action={submit} className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#11131b] p-6"><p className="text-xs uppercase tracking-widest text-violet-300">KnightForge</p><h1 className="mt-2 text-2xl font-semibold">Private sign in</h1><label className="mt-6 block text-sm">Username<input name="username" autoComplete="username" required className="field mt-2 w-full" /></label><label className="mt-4 block text-sm">Password<input name="password" type="password" autoComplete="current-password" required className="field mt-2 w-full" /></label><input type="hidden" name="callbackUrl" value={typeof window === "undefined" ? "/" : new URLSearchParams(window.location.search).get("callbackUrl") ?? "/"} /><button className="btn mt-5 w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>{error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}</form></main>;
}
