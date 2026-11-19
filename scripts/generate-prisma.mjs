import { spawnSync } from "node:child_process";

const schemas = {
  sqlite: "prisma/schema.prisma",
  postgresql: "prisma/postgresql/schema.prisma",
};
const provider = process.env.GMB_DB_PROVIDER ?? "sqlite";
if (!Object.hasOwn(schemas, provider)) {
  console.error("GMB_DB_PROVIDER must be sqlite or postgresql.");
  process.exit(1);
}

const result = spawnSync(process.execPath, [
  "node_modules/prisma/build/index.js", "generate", "--schema", schemas[provider],
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
