const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);
export function privateRequestDecision(authenticated: boolean, path: string, method: string, origin: string | null, expectedOrigin: string) {
  if (!authenticated) return path.startsWith("/api/") ? "unauthorized" : "redirect";
  if (path.startsWith("/api/") && !safeMethods.has(method.toUpperCase()) && origin !== expectedOrigin) return "csrf";
  return "allow";
}
