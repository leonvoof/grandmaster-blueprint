import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
const { auth } = NextAuth(authConfig);
import { privateRequestDecision } from "@/lib/auth-policy";
export default auth((request) => {
  const decision = privateRequestDecision(Boolean(request.auth), request.nextUrl.pathname, request.method, request.headers.get("origin"), request.nextUrl.origin);
  if (decision === "allow") return NextResponse.next();
  if (decision === "unauthorized") return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (decision === "csrf") return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const login = new URL("/login", request.url);
  login.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(login);
});
export const config = { matcher: ["/((?!login|api/auth|_next/static|_next/image|favicon.ico|stockfish/).*)"] };
