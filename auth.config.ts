import type { NextAuthConfig } from "next-auth";
const authConfig = {
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [],
} satisfies NextAuthConfig;
export default authConfig;
