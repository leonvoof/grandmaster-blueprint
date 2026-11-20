# KnightForge deployment

## Status

SQLite and PostgreSQL builds are supported locally. The SQLite-to-PostgreSQL transfer tool has been verified locally. Cloud deployment and transfer of real records are later steps.

For a no-login site, follow **KnightForge public mode** below. The Neon and authenticated setup in this guide is for the private workspace.

Step 2 used disposable local databases and synthetic records. The original SQLite database has a verified local backup.

## Build and migration commands

| Purpose | Command |
| --- | --- |
| Start local SQLite development | `npm run dev` |
| Build for SQLite | `npm run build` |
| Apply SQLite migrations explicitly | `npm run db:push` |
| Build for PostgreSQL | `GMB_DB_PROVIDER=postgresql npm run build` |
| Apply PostgreSQL migrations explicitly | `npm run db:migrate:postgres` |
| Check PostgreSQL migration status | `npx prisma migrate status --schema prisma/postgresql/schema.prisma` |

Set `GMB_DB_PROVIDER` in the shell or build environment before running the build. It defaults to `sqlite`. Builds generate the matching Prisma Client into the standard `@prisma/client` location. All routes continue to use that client through `lib/prisma.ts`. Changing a runtime environment variable cannot change the provider in a built artifact.

Use separate checkouts or copies with separate `node_modules` and `.next` directories when working on both targets concurrently. `npm run dev` regenerates the SQLite client and applies the existing SQLite migrations as part of local startup. Both production build targets generate the client and prepare Stockfish assets without executing migrations.

The SQLite schema and history live under `prisma/schema.prisma` and `prisma/migrations`. The PostgreSQL schema and independent baseline live under `prisma/postgresql/`. When changing models, keep both schemas in sync and create a separate migration for each provider. PostgreSQL uses shorter explicit names for two opening training indexes to fit its identifier limit. Opening training’s chapter and repertoire references remain scalar so historical reviews can outlive edited or removed lines, as in SQLite.

## PostgreSQL environment

- `DATABASE_URL` is the PostgreSQL runtime connection string. For Neon, use the pooled URL whose host contains `-pooler`, with TLS. This project uses Prisma 6's classic query engine, so add `pgbouncer=true` for transaction-pool compatibility and `connection_limit=1` to bound per-function client connections. Example shape: `postgresql://…@ep-…-pooler.…/dbname?sslmode=require&pgbouncer=true&connection_limit=1`. Keep it server-side.
- `DIRECT_URL` is the direct connection string used by Prisma 6 CLI migration commands. Supply it alongside `DATABASE_URL` in the migration shell or an ignored Prisma-readable `.env`. Production application queries need only `DATABASE_URL`.
- The PostgreSQL build can generate its Prisma Client without connection strings. Set `DATABASE_URL` before starting the built app.
- `GMB_TRANSFER_POSTGRES_URL` is only for the local transfer command. Use a direct Neon connection with `sslmode=verify-full` as its sole query parameter. Do not set this on Vercel.
- Keep database URLs and the optional `LICHESS_API_TOKEN` in server environment variables. Keep SQLite files, backups, and exports out of Git. See [Neon's Prisma guide](https://github.com/neondatabase/website/blob/main/content/docs/guides/prisma.md), [Prisma 6 Neon connection guidance](https://www.prisma.io/docs/orm/v6/overview/databases/neon), and [Prisma's PgBouncer guidance](https://www.prisma.io/docs/orm/v6/prisma-client/setup-and-configuration/databases-connections/pgbouncer).

The current app uses Prisma 6's classic client rather than Neon's newer JavaScript driver adapter. Prisma 6 supports PostgreSQL and PgBouncer compatibility mode through the URL flag above. The matching direct `DIRECT_URL` is used by `prisma migrate deploy`; never run migrations against the pooled URL. The isolated PostgreSQL tests verified this application's Prisma client and queries against PostgreSQL, but no Neon account or endpoint has been contacted, so a Neon TLS/pooler connection smoke test remains a launch check.

## Testing PostgreSQL locally

Create an empty, disposable local PostgreSQL database. Set both URLs to that database and run `npm run db:migrate:postgres`, then `GMB_DB_PROVIDER=postgresql node scripts/generate-prisma.mjs` and `npm run test:postgres` in a separate copy. The test writes synthetic records and expects a fresh database. The standard `npm test` suite uses the SQLite client.

Step 2 verified both build targets, explicit baseline deployment and zero schema drift on PostgreSQL 18.7, and persistence through the existing game, analysis, opening import, and spaced repetition services. HTTP smoke checks on both targets covered login, unauthenticated page redirects, API 401 responses, and authenticated Games reads. The builds emitted Edge Runtime warnings from the existing Auth.js/Jose dependency around compression. The local Auth.js session checks passed.

Vercel and Neon runtime checks, including pooled TLS connections, deployment protection, and Stockfish worker delivery, remain pending. Stockfish uses static browser-worker assets. Lichess caches and locks in process memory remain instance-local on serverless hosts.

## Transfer a SQLite snapshot after approving the real-data move

1. Use Node 22.13+ (Node 24 was used for verification) and install dependencies with `npm ci`. Create a dedicated, empty Neon database. Keep the app disconnected from the destination during the transfer.
2. Create a private, consistent snapshot on your Mac and check it. Use a new path for each backup and keep the snapshot and reports outside the repository.

   ```sh
   umask 077
   sqlite3 -readonly prisma/dev.db ".backup '/absolute/private/path/chess-snapshot.db'"
   sqlite3 -readonly /absolute/private/path/chess-snapshot.db 'PRAGMA integrity_check; PRAGMA foreign_key_check;'
   ```

   The integrity command should print `ok` and no foreign-key violations. Keep the original SQLite database and the snapshot.
3. Set server-only `DATABASE_URL` to the pooled URL and `DIRECT_URL` to the direct URL for that same Neon database. Load the values from an ignored environment file or your secret manager. Apply PostgreSQL migrations explicitly and confirm their status.

   ```sh
   npm run db:migrate:postgres
   npx prisma migrate status --schema prisma/postgresql/schema.prisma
   ```

4. Set `GMB_TRANSFER_POSTGRES_URL` to the **direct** connection URL for the destination. Use `?sslmode=verify-full` as the sole query parameter in this transfer URL. Leave the app's pooled URL unchanged. Generate the transfer tool's Prisma model metadata, then run the default dry run.

   ```sh
   npx prisma generate --schema prisma/schema.prisma
   npm run --silent db:transfer -- --source /absolute/private/path/chess-snapshot.db --allow-remote > /absolute/private/path/dry-run.json
   ```

   Both the dry run and the actual transfer send row values to the destination. The dry run performs the full insert and verification inside a transaction, then rolls back. Run either command against Neon only after approving real data transfer. Check that the command exited successfully, the report says `dry-run-rolled-back`, and every table has matching source, inserted, and verified counts.
5. Run the same transfer against the same snapshot with `--apply` and retain the report.

   ```sh
   npm run --silent db:transfer -- --source /absolute/private/path/chess-snapshot.db --allow-remote --apply > /absolute/private/path/committed.json
   ```

   A successful report says `committed`. It reports per-table counts, key checks, and full value verification without logging values or IDs. Before using the cloud app, open representative games, analyses, opening notes and reviews, and puzzle attempts against the migrated database.

The tool locks the PostgreSQL tables and refuses a populated destination. Ordinary failures roll back the entire transaction. If the connection drops while committing, the result can be ambiguous. Inspect the destination before retrying. Preserve any committed rows and use a fresh empty destination if a separate trial is needed. Builds and app startup do not run this tool.

The tool covers all 14 current models in the `public` schema. It verifies each primary key and each scalar value, including PGNs, analysis lines, opening relationships, idempotency keys, and scheduling history. JSON is compared as PostgreSQL JSONB, so object key order and whitespace are normalized. It supports UTF-8 text, signed 32-bit integers, finite floating point values, booleans, millisecond timestamps, JSON, and SQL NULL. It rejects unsupported types and values such as BLOBs, NUL text, and sequence-backed columns. Current model IDs are text and need no sequence adjustment.

To repeat the synthetic integration test, use a fresh migrated loopback database named `gmb_transfer_<suffix>` and set `GMB_TRANSFER_TEST_URL` to its URL. In a separate copy, generate the PostgreSQL Prisma Client and run `npm run test:transfer`. The test creates its own SQLite fixtures and writes synthetic records to the test destination.

## Single-user authentication implemented

- The App Router is gated by `middleware.ts`: unauthenticated page requests redirect to `/login`; all `/api/*` requests (including GET) return 401. Auth.js callback endpoints, login, Next static/image assets, favicon, and Stockfish worker assets remain reachable. Authenticated unsafe API requests require a same-origin `Origin` header and cross-origin writes receive 403.
- Auth.js Credentials uses bcrypt-hashed password verification and encrypted JWT sessions in HTTP-only, SameSite=Lax cookies with an eight-hour lifetime. Auth.js supplies CSRF protection for its sign-in/sign-out endpoints. Login failures are throttled after eight failures per IP per process instance. No credential defaults or secrets are committed.
- Local setup: copy `.env.example` to `.env.local`; set `AUTH_SECRET` to `openssl rand -base64 32`, choose `AUTH_USERNAME`, and generate `AUTH_PASSWORD_HASH` from a strong password with `GMB_SETUP_PASSWORD='…' node scripts/hash-password.mjs`. Keep `.env.local` out of Git. Set the same three server-only variables in Vercel later. Missing variables fail closed (login cannot authenticate); there is no fallback password.
- Limitation: failed-login throttling is in-memory and therefore best-effort across serverless instances. Production launch is blocked until Vercel Authentication protects **All Deployments** (production and previews) or a separately verified shared protection mechanism is in place. This per-process throttle is not an internet-facing perimeter. No database user table or auth migration was added.

## Private Vercel launch preparation

### Public GitHub repository setup

The source repository is intended to be public. Publishing source does not make the deployed app or its data public. Keep Auth.js enabled and require Vercel Authentication with **All Deployments** for production and preview URLs. Never include user records, secrets, SQLite files, backups, or private exports.

```sh
git status --short
git check-ignore -v .env.local prisma/dev.db prisma/dev.db.backup-postgresql-20261119-124738 .vercel/
git ls-files
```

Before the first commit, inspect every staged file with `git diff --cached --name-only` and `git diff --cached --stat`. Do not stage `.env*` (except `.env.example`), any database/backup, PGN/CSV export, generated files, or secrets. Add only after review, then commit locally.

To publish later: create a new GitHub repository, select **Public**, do not initialize it with a README/license/gitignore, then add its SSH or HTTPS URL as `origin`. After the local commit has passed review, push with:

```sh
git remote add origin git@github.com:YOUR-ACCOUNT/grandmaster-blueprint.git
git branch -M main
git push -u origin main
```

Use the GitHub-provided noreply author email if you do not want a personal email in commit metadata. Keep Auth.js and Vercel Deployment Protection enabled. No remote is configured or contacted in this preparation.

### Vercel deployment settings

`vercel.json` pins the Vercel build command to `GMB_DB_PROVIDER=postgresql npm run build`. The `prebuild` hook generates the PostgreSQL Prisma Client and copies the pinned Stockfish files into `public/stockfish/19.0.1`. The build does not run `prisma migrate`, `db push`, or the SQLite transfer tool. Migrations remain an explicit operator step.

Before any website is considered launched, configure the Vercel project at **Security (or Settings) → Deployment Protection**:

1. Enable **Vercel Authentication**.
2. Choose scope **All Deployments**. This protects both production domains and every preview/deployment URL on Hobby. Standard Protection leaves production domains public.
3. Keep project access restricted to your own Vercel account. Do not create shareable access links, protection bypasses, or public exceptions.
4. Verify from a signed-out private browser that the production URL and a preview URL both show Vercel's access gate. Then sign in to Vercel and confirm your account can reach the site. Vercel's gate runs before Next.js middleware.
5. The app then presents its separate Auth.js username/password login. Keep this second gate enabled. Verify a wrong password fails, the valid credentials reach the app, and unauthenticated API calls remain 401 after passing the Vercel gate.

Vercel's September 9, 2026 changelog says All Deployments protection is available on every plan at no additional cost. The Vercel docs define this scope as covering preview and production domains. Confirm the current project dashboard shows the saved setting before launch: [Vercel announcement](https://vercel.com/changelog/protect-production-deployments-for-free-on-every-plan) and [Deployment Protection docs](https://vercel.com/docs/deployment-protection).

The Auth.js configuration uses encrypted JWT sessions with an eight-hour maximum age. It derives the callback origin from the incoming request; Auth.js detects Vercel's trusted hosting environment, so do not pin `AUTH_URL` to a preview host. No OAuth provider is configured, so there are no provider callback URLs to register. Auth.js defaults to secure cookies on HTTPS and HTTP-only, SameSite=Lax session cookies. Keep `AUTH_SECRET` identical across production and previews if you want the same credentials setup, but rotate it only with a planned session invalidation. Auth.js's credential flow retains its CSRF token checks. The app's unsafe API writes require a same-origin `Origin`. Avoid forwarding production secrets into browser variables or public build output.

The process-local login throttle remains defense in depth only. Vercel Authentication All Deployments is a required launch gate, not an optional hardening step. If that setting cannot be verified, do not expose the application; use a verified shared limiter/proxy protection before launch instead.

### Environment variables

Set these as **server-only** variables in Vercel. Put app values in Production and Preview scopes only if those environments will be used, and use a separate empty/test Neon branch for Preview rather than sharing personal data.

| Variable | Vercel runtime/build | Where its value comes from |
| --- | --- | --- |
| `GMB_DB_PROVIDER` | Build-time only | `vercel.json` sets it in the build command; no runtime variable is needed |
| `DATABASE_URL` | Required server-only runtime value | Neon pooled URL (`-pooler` hostname), `sslmode=require`, plus `pgbouncer=true&connection_limit=1` for Prisma 6 classic client |
| `AUTH_SECRET` | Required server-only runtime value | Generate a random value at least 32 characters long. Never reuse a sample or commit it. |
| `AUTH_USERNAME` | Required server-only runtime value | Chosen login name |
| `AUTH_PASSWORD_HASH` | Required server-only runtime value | bcrypt hash created by `scripts/hash-password.mjs`; never place the cleartext password in Vercel or Git |
| `LICHESS_API_TOKEN` | Optional server-only runtime value | Only if authenticated Lichess Opening Explorer access is wanted |

Keep `DIRECT_URL` and `GMB_TRANSFER_POSTGRES_URL` out of Vercel unless there is an independently justified operator workflow. Run schema migrations and data transfer from the trusted Mac terminal with those values loaded only for the command. `DIRECT_URL` is the direct Neon endpoint used by the Prisma CLI. `GMB_TRANSFER_POSTGRES_URL` is also direct and uses `sslmode=verify-full` for the transfer script. Do not enable `NEXT_PUBLIC_` on any of these values. Auth.js automatically trusts Vercel's proxy host; `AUTH_URL` is not required for this Credentials-only setup.

### Exact launch sequence

1. Create the Vercel Hobby project and a Neon Free project manually. Do not connect the project to the personal SQLite database, and do not create Preview credentials that point to production data. Before pushing, inspect `git status --short` and `git ls-files`; make sure no `.env.local`, database, backup, data export, or secret file is tracked. Confirm `.env.local`, `prisma/dev.db`, and `.vercel/` are ignored with `git check-ignore -v`.
2. In Neon, create a clean Production branch/database and copy both the pooled and direct connection strings. First test the strings against a disposable Neon branch or another synthetic-only database. Confirm PostgreSQL TLS and a simple Prisma read/write before any personal data transfer. The isolated local PostgreSQL test is not a substitute for this Neon-specific check.
3. Add the runtime variables above to Vercel, using independent synthetic-only Preview credentials if previews are enabled. Add the Vercel All Deployments protection before sharing any deployment URL.
4. From a trusted terminal, load `DIRECT_URL` and run `npm run db:migrate:postgres`; check `npx prisma migrate status --schema prisma/postgresql/schema.prisma`. Builds and startup do not apply migrations.
5. Build and deploy a synthetic-only version. Check the deployment logs for `GMB_DB_PROVIDER=postgresql`, and confirm no migration command ran during build. Verify production and Preview are both gated while signed out.
6. Test the Auth.js login flow over HTTPS. Check that the session cookie is Secure, HttpOnly, SameSite=Lax, and expires at the expected eight-hour limit. Check login failure, logout, an expired/tampered session, and 401 on direct unauthenticated GET/write API requests after passing the Vercel gate.
7. Verify the Stockfish worker JS and WASM respond from `/stockfish/19.0.1/` with successful content responses, then analyze one synthetic FEN. Check Lichess public import using synthetic/test records, a saved game analysis read/write, Opening Academy read/write, and opening training schedule/history reads/writes. User-specific data must be synthetic during this stage.
8. To migrate real records, first obtain explicit approval for the transfer. Create and integrity-check a private SQLite snapshot using the instructions earlier in this document. Migrate the PostgreSQL schema, run the transfer's dry-run against Neon, inspect the complete report, then run `--apply` only after approving those rows. Keep the original SQLite database and snapshot unchanged. Verify every model, scalar values, FKs, IDs, PGNs, analysis records, repertoire branches/notes, training schedules/history, and puzzle attempts using the report plus representative application reads. Save reports outside Git.
9. Only after integrity checks pass should production `DATABASE_URL` point at the migrated database. Re-run the protected-site login and data checks from phone and desktop. Confirm there are no public preview exceptions or shareable bypass links.

### Rollback and recovery

- If build, protection, auth, worker, or database smoke tests fail, keep All Deployments protection on and do not share the URL. Use Vercel's deployment rollback to restore the last known-good app artifact. App rollback does not roll back Neon schema or data.
- Keep the original SQLite file and verified snapshot untouched. Do not point the local app at the Neon URL as a recovery action.
- Before migration, retain an empty destination and a clean backup/snapshot. If migrations fail before data import, inspect Prisma migration status and logs; fix forward with a new additive migration or use a new empty Neon branch. Do not reset a destination containing records.
- If a transfer reports `committed`, preserve the destination and report. If a connection drops during commit, treat the result as ambiguous and inspect all destination table counts/keys before any retry. The transfer tool refuses populated tables; never bypass that guard. If a confirmed bad import must be recovered, restore into a separate clean Neon branch/database from a pre-import backup and verify it before changing `DATABASE_URL`.
- If a schema migration has already been applied, do not delete migration history or manually drop tables. Use a reviewed forward migration. Maintain a copy of the prior deployment and database backup until production reads have been verified.

### Serverless behavior and limits

All database API routes use Prisma in Next.js's Node.js runtime; the Lichess route explicitly selects Node.js. Stockfish executes in a browser Web Worker and its version-pinned assets are copied by the prebuild hook, so it does not consume Vercel function CPU. Lichess sync emits progress and commits per game, with an explicit 60-second maximum duration compatible with Hobby's non-fluid maximum; if interrupted, rerun sync and rely on existing ID/fingerprint deduplication. Analysis API writes, Opening Academy persistence, and training API operations are request-scoped database work and require the pooled URL.

Some Lichess and Opening Explorer caches/locks remain process-local. On a serverless host, separate instances do not share those values, so simultaneous requests from multiple deployments are not globally coordinated. The single-user workflow should avoid concurrent syncs; this is not a shared queue or distributed rate limiter.

### Verification status for this preparation step

- `npx tsc --noEmit`, `npm run lint`, and `npm test` passed; the standard suite reports 86 passing tests, including three deployment-configuration checks.
- The exact `vercel.json` PostgreSQL build command passed in an isolated project copy. A second isolated production SQLite build was used only for application-login smoke testing; neither build shared the active development server's `.next` directory. Both generated 27 routes. The PostgreSQL build required no database connection and the build logs contained no migration or transfer command.
- With `VERCEL=1` and synthetic credentials, the isolated production app verified 13 private GET API paths return 401, private `/games` redirects when signed out, `/login` is public, credentials issue an encrypted session, logout clears the session, and a tampered session is rejected. Authenticated `/games` and `/openings` requests returned 200. A cross-origin write returned 403. An HTTPS `AUTH_URL` simulation verified the session cookie's `Secure`, `HttpOnly`, `SameSite=Lax`, and eight-hour expiry attributes. This is an Auth.js production-runtime smoke test, not a live Vercel access-gate test.
- The built app served `stockfish-19-lite-single.js` (28,230 bytes) and `stockfish-19-lite-single.wasm` (1,845,971 bytes) with HTTP 200. The existing engine tests execute a real WASM search. No real games or other user records were used in the smoke-test database.
- Neon TLS/pooler, actual Vercel Authentication All Deployments behavior, phone/desktop deployment access, and live Lichess service calls are not verifiable without creating resources. They remain launch checklist actions. The app workspace is not a Git repository, so there is no commit history to audit; `.gitignore` excludes `.env*` except `.env.example`, database files/backups, and `.vercel/`. Before creating/pushing a repository, run `git status` and `git ls-files` checks described in the launch checklist.

## KnightForge public mode

Set `GMB_SITE_MODE=public` for both build and runtime. Local mode defaults to the existing authenticated workspace. A Vercel production deployment with a missing or invalid mode returns 404. A Vercel Preview deployment accepts public mode or returns 404, including when configured as private. Keep Vercel system environment variables enabled so the app receives `VERCEL_ENV`.

### Route and data inventory

**A** is public read-only content, **B** is anonymous work confined to the visitor's browser, and **C** is private server functionality. Public mode accepts only GET and HEAD on the listed public pages and static assets. It has zero public API endpoints.

| Route or operation | Class | Public behavior |
| --- | --- | --- |
| `/` | A | Public landing page. The private dashboard's Prisma profile lookup and onboarding branch are C and skipped. |
| `/games`, `/analysis` | B | Legal chessboard, PGN replay, FEN loading, browser-worker Stockfish, browser-local saved PGNs, and explicit public Lichess game imports. |
| `/openings` | B | Recall a browser-local PGN main line. The private Opening Academy and database scheduling are C. |
| `/tactics` | A, B | Eight bundled, legally validated rows from the [CC0 Lichess Puzzle Database](https://database.lichess.org/#puzzles). Solving and completion counts use browser storage. |
| `/_next/static/*`, `/favicon.ico`, five named `/stockfish/19.0.1/*` assets | A | Read-only application and worker files. No arbitrary paths in the Stockfish directory are served. |
| `/login`, `/api/auth/*` GET/POST | C | Private login, credential callbacks, session reads and logout are unavailable. |
| `/api/profile` GET/POST | C | Reads/upserts the private player profile. |
| `/api/games` GET/POST | C | Lists and imports private PGNs, with fingerprint deduplication. |
| `/api/games/[gameId]/analyses` GET/POST | C | Reads/writes stored Stockfish analysis. |
| `/api/games/[gameId]/reviews` GET/POST | C | Reads/writes mistake review attempts and reflections. |
| `/api/lichess` GET/PUT/POST | C | Reads/writes account settings and syncs public Lichess games into the private database. |
| `/api/openings` GET/POST, `/api/openings/chapters` POST | C | Lists/creates repertoires and creates chapters. |
| `/api/openings/[chapterId]` PATCH | C | Adds, edits, or deletes private lines and saves notes. |
| `/api/openings/import` POST, `/api/openings/export` GET | C | Imports and exports private repertoires. |
| `/api/openings/explorer` GET | C | Queries personal games or reads upstream data using server credentials. |
| `/api/openings/training` GET/POST | C | Reads/writes spaced repetition positions, schedules, and history. |
| `/api/tactics` GET, `/api/tactics/import` POST, `/api/tactics/attempts` GET/POST | C | Queries the private collection and attempt history and writes puzzles or attempts. |
| `/api/weaknesses` GET, `/weaknesses` | C | Reads game and analysis records for the private report. |
| `/calculation`, `/strategy`, `/endgames`, `/otb-training`, `/coach`, `/progress`, unknown routes | C | Existing unfinished routes are omitted from public navigation. Other paths fail closed. |

There are no Next.js server actions. Login's form handler is client-side and uses the private Auth.js endpoints. The API handlers independently reject non-private modes, and the Prisma accessor refuses to initialize outside private mode. These controls apply even if a public deployment is accidentally given a connection string. Do not provision one.

Browser-only data is per origin and browser profile. KnightForge stores PGNs, imported Lichess game IDs/usernames, and completion counts in localStorage and supports a validated 4 MB JSON backup. The library accepts up to 200 PGNs; each PGN is limited to 16,000 characters and each Lichess import is explicitly capped at 10, 25, 50, or 100 games. Download a backup before clearing site data or changing domains. Importing a Lichess game does not replace existing progress. Restoring a backup replaces browser progress only after confirmation. Temporary engine cache entries are outside the backup. Public mode does not provide authenticated Lichess account sync, private mistake reviews, database-backed analysis, repertoire editing/notes, spaced repetition, or profile statistics.

#### Public Lichess game import

The public Games workspace makes one explicit browser request to the official [`GET /api/games/user/{username}` endpoint](https://github.com/lichess-org/api/blob/master/doc/specs/tags/games/api-games-user-username.yaml), requesting PGN with `Accept: application/x-chess-pgn`. It sends no cookies, OAuth token, or personal API token and adds no KnightForge API route or proxy. The selected `max` is always sent; games are requested newest first, with finished games, opening tags, and clocks when available. `perfType` supports Classical, Rapid, Blitz, or the supported standard time controls (`ultraBullet`, `bullet`, `blitz`, `rapid`, `classical`, and `correspondence`).

The Lichess API specification advertises cross-origin access and an anonymous export throughput of 20 games per second. It also requires clients to identify themselves using a User-Agent and says clients should make only one request at a time; after HTTP 429, wait at least one minute before retrying. Browser JavaScript cannot set or override the browser's User-Agent. In a local production-server test, a normal Chrome browser successfully fetched real public PGN data cross-origin from Lichess, so the import uses direct browser access and lets the browser send its own User-Agent and origin. A detectable HeadlessChrome User-Agent received an HTML 404 in the same test, while a normal Chrome User-Agent succeeded. The endpoint currently accepts the normal browser request, but its User-Agent requirement remains a limitation because KnightForge cannot identify itself in that forbidden browser header. KnightForge serializes imports across tabs in the same browser profile with the Web Locks API where available, caps each request to the selected number of games (and the response to 4 MB), and persists a 60-second 429 cooldown. If Lichess over-returns beyond `max`, only the newest selected number are parsed and stored. It never retries or syncs in the background. If a network, browser policy, or future Lichess policy blocks a request, the Games page retains manual PGN paste and file-import controls.

Returned games are individually parsed with chess.js; malformed or illegal games are counted and skipped. Lichess game IDs are used for deduplication when present, with normalized PGN as the fallback identity. Imported metadata and PGNs are stored in the existing browser-local progress document so games appear in the saved-game selector, survive refreshes, work with board navigation and local Stockfish, and are included in JSON backups. Storage quota errors preserve the previous saved document and are shown to the visitor. The official API's rate, CORS, format, and parameter details are documented in the [Lichess API reference](https://lichess.org/api) and its [OpenAPI spec](https://github.com/lichess-org/api/blob/master/doc/specs/lichess-api.yaml).

### Public release procedure

1. Review `git status --short` and `git diff`. When approved, stage the intended files, run `git diff --cached --stat`, commit, and check `git remote -v` before `git push origin HEAD` to a review branch. Pushing to a Vercel-connected repository may trigger a deployment. Keep the existing protection enabled.
2. Prefer a **separate** Vercel project for the public site so older private deployments and their credentials remain protected. Use the same PostgreSQL build command. Set `GMB_SITE_MODE=public` in Preview and Production. Leave `DATABASE_URL`, `DIRECT_URL`, `GMB_TRANSFER_POSTGRES_URL`, Auth.js credentials, and `LICHESS_API_TOKEN` unset. No database initialization or transfer is required. Avoid shared environment variable groups and Neon integrations on this project.
3. Verify the protected Preview and Production artifacts. With the outer gate satisfied, the landing page and four public workspaces must function without an app session. Test real worker execution, data persistence after refresh, backup/restore, and 404 responses for private APIs even with cookies and unsafe methods. Verify no public deployment inherited private credentials.
4. If renaming a Vercel project, open **Project Settings → General → Project Name** and save `knightforge` if available. Verify Domains and any integrations separately. Use JSON backup/restore if the origin changes. [Vercel project rename guide](https://vercel.com/kb/guide/how-do-i-change-the-name-of-my-vercel-project)
5. Only after successful verification and explicit release approval, disable **Vercel Authentication** under **Deployment Protection** on the public-only project. Verify all deployments in that project are public-mode artifacts with no private credentials before changing the toggle, which applies to older deployments as well. Keep the private project's gate on. Verify signed-out access and private-route denials from a clean browser. [Vercel Authentication settings](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication)
6. To roll back a public release, restore Vercel Authentication first and redeploy a known-good public artifact. Use the existing private project or local private mode for the authenticated workspace. For private Vercel Production, explicitly set `GMB_SITE_MODE=private` and keep **All Deployments** protection. Browser backups can be restored by visitors on the public site. Rollback requires no database changes.

### Exact Vercel Production configuration for the no-login release

Use a dedicated Vercel project connected to the reviewed KnightForge repository, with the repository root as **Root Directory** and **Next.js** as the framework preset. Keep the Vercel-provided build command from `vercel.json`:

```sh
GMB_DB_PROVIDER=postgresql npm run build
```

Set this one application environment variable for **Production**:

| Name | Value | Scope |
| --- | --- | --- |
| `GMB_SITE_MODE` | `public` | Production; set Preview to `public` only when intentionally testing public previews |

`VERCEL_ENV` is supplied by Vercel and must remain enabled. No database or authentication environment variable is required by public mode. In particular, do **not** configure `DATABASE_URL`, `DIRECT_URL`, `GMB_TRANSFER_POSTGRES_URL`, `AUTH_SECRET`, `AUTH_USERNAME`, `AUTH_PASSWORD_HASH`, or `LICHESS_API_TOKEN` in the public project. Keep any existing values only on the separate private project. Public mode refuses Prisma access even if a database URL is accidentally present, but omitting private credentials is still required defense in depth.

The build command selects the PostgreSQL-generated Prisma Client because that is the project's Vercel build target; it does not connect to a database or run migrations. It does not activate public mode. `GMB_SITE_MODE=public` is read by server routes at runtime. In Vercel Production, an absent or invalid `GMB_SITE_MODE` returns 404. If Vercel system environment variables are unavailable outside Vercel, the local default is the authenticated private mode, never anonymous public mode. Preview with absent, invalid, or `private` mode returns 404. Thus, a Preview deployment has no route to Production private data, and the recommended Preview environment has no database credentials in the first place.

Keep **Vercel Authentication** enabled while preparing and verifying this release. Before disabling it, test the deployed Production and Preview artifacts while the gate is still on, then complete the separate, explicit approval step in the release procedure above. Disabling the gate is not part of this preparation.

### Local verification of the public build

TypeScript, lint, all 92 tests, and the public PostgreSQL production build passed. Headless Chrome verified the public workspaces, Stockfish search, local persistence, JSON restore across profiles, and invalid backup rejection. A disposable PostgreSQL database confirmed that 266 private API requests were refused even with a valid private session, and that all 14 database tables remained unchanged. The Preview checks simulated Vercel environment variables locally. Repeat the launch checks on the protected hosted artifact before releasing it.
