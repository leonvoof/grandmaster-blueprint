import { type NextRequest, NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
const { auth } = NextAuth(authConfig);
import { privateRequestDecision } from "@/lib/auth-policy";
import { publicRequestAllowed, siteMode } from "@/lib/site-mode";
const privateMiddleware = auth((request) => {
  const decision = privateRequestDecision(Boolean(request.auth), request.nextUrl.pathname, request.method, request.headers.get("origin"), request.nextUrl.origin);
  if (decision === "allow") return NextResponse.next();
  if (decision === "unauthorized") return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (decision === "csrf") return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const login = new URL("/login", request.url);
  login.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
});
export default function middleware(request: NextRequest, event: Parameters<typeof privateMiddleware>[1]) {
  const mode = siteMode();
  const path = request.nextUrl.pathname;
  if (mode === "public" && publicRequestAllowed(path, request.method)) {
    const response = NextResponse.next();
    if (path === "/openings") {
      // The OAuth provider returns its one-time authorization code in the query.
      response.headers.set("Referrer-Policy", "no-referrer");
    }
    return response;
  }
  if (mode !== "private") {
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (path === "/login" || path.startsWith("/api/auth/") || path.startsWith("/_next/static/")
    || path.startsWith("/_next/image") || path === "/favicon.ico" || path.startsWith("/stockfish/")) {
    return NextResponse.next();
  }
  return privateMiddleware(request, event);
}

export const config = { matcher: ["/:path*"] };
