import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import authConfig from "@/auth.config";

const failures = new Map<string, { count: number; until: number }>();
const cooldownMs = 15 * 60 * 1000;
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [Credentials({
    credentials: { username: { label: "Username", type: "text" }, password: { label: "Password", type: "password" } },
    async authorize(credentials, request) {
      const username = process.env.AUTH_USERNAME;
      const passwordHash = process.env.AUTH_PASSWORD_HASH;
      if (!username || !passwordHash || !process.env.AUTH_SECRET) return null;
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const attempt = failures.get(ip);
      if (attempt && attempt.until > Date.now() && attempt.count >= 8) return null;
      const valid = typeof credentials.username === "string" && typeof credentials.password === "string"
        && credentials.username === username && await bcrypt.compare(credentials.password, passwordHash);
      if (!valid) {
        const next = attempt && attempt.until > Date.now() ? { count: attempt.count + 1, until: attempt.until } : { count: 1, until: Date.now() + cooldownMs };
        failures.set(ip, next);
        return null;
      }
      failures.delete(ip);
      return { id: username, name: username };
    },
  })],
});
