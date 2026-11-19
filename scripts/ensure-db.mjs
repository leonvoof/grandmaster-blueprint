import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databaseFile = resolve("prisma/dev.db");
mkdirSync(dirname(databaseFile), { recursive: true });
if (!existsSync(databaseFile)) closeSync(openSync(databaseFile, "a"));
