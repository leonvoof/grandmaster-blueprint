export type SiteMode = "public" | "private" | "blocked";

export function resolveSiteMode(mode?: string, vercelEnvironment?: string): SiteMode {
  if (mode === "public") return "public";
  if (vercelEnvironment && vercelEnvironment !== "production") return "blocked";
  if (mode === "private" || (!mode && !vercelEnvironment)) return "private";
  return "blocked";
}

export function siteMode() {
  return resolveSiteMode(process.env.GMB_SITE_MODE, process.env.VERCEL_ENV);
}

export const publicPages = ["/", "/games", "/analysis", "/tactics", "/openings", "/coach"] as const;

const stockfishAssets = new Set(["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm", "NOTICE.txt", "AUTHORS.txt", "Copying.txt"]);

// There are no public API handlers. The puzzle bank ships as static, read-only data.
export function publicRequestAllowed(path: string, method: string) {
  if (method !== "GET" && method !== "HEAD") return false;
  if (publicPages.some((page) => page === path)) return true;
  if (path.startsWith("/_next/static/") || path === "/favicon.ico" || path === "/opening-library/lichess-cc0.json" || path === "/opening-library/CC0.txt") return true;
  const prefix = "/stockfish/19.0.1/";
  return path.startsWith(prefix) && stockfishAssets.has(path.slice(prefix.length));
}

export function privateRouteDisabled() {
  if (siteMode() === "private") return null;
  return Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
}
