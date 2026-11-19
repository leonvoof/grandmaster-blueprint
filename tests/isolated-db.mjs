import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PrismaClient } from "@prisma/client";

export async function withIsolatedDb(run) {
  const directory = await mkdtemp(join(tmpdir(), "blueprint-test-"));
  const file = join(directory, "test.db");
  try {
    const sqlite = new DatabaseSync(file);
    try {
      const migrations = new URL("../prisma/migrations/", import.meta.url);
      const entries = await readdir(migrations, { withFileTypes: true });
      for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
        sqlite.exec(await readFile(new URL(`${name}/migration.sql`, migrations), "utf8"));
      }
    } finally {
      sqlite.close();
    }
    const db = new PrismaClient({ datasourceUrl: `file:${file}` });
    try {
      return await run(db, file);
    } finally {
      await db.$disconnect();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
