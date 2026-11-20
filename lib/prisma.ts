import { PrismaClient } from "@prisma/client";

import { siteMode } from "./site-mode.ts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function privateClient() {
  if (siteMode() !== "private") throw new Error("Server storage is available only in private mode.");
  const client = globalForPrisma.prisma ?? new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
  globalForPrisma.prisma = client;
  return client;
}

// Resolve lazily so importing a private route never constructs a client in public mode.
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = privateClient();
    const value: unknown = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
