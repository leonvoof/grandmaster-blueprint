# KnightForge

A local-first chess training workspace for a player around 1800 Lichess Classical aiming toward Candidate Master (2200 FIDE Standard).

## Start locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Before starting the dev server, the `predev` script generates Prisma Client and initializes/synchronizes the SQLite database at `prisma/dev.db`. The first visit opens profile onboarding. The database stays local and is ignored by Git.

To run a production build locally:

```bash
npm run db:push
npm run build
npm start
```

Production builds leave the local database untouched. Run the explicit migration command before first startup or when applying a new schema.

The Opening Academy works offline from saved PGNs, games, and repertoire lines. Optional Lichess Opening Explorer and Masters data require a personal API token: copy `.env.example` to `.env.local` and set `LICHESS_API_TOKEN` there, then restart the server. The token is read only by the server-side route and is never sent to the browser. Without it, choose **My saved games and PGNs** for local statistics. Lichess explorer endpoints use OAuth2-authenticated requests; see the [official API documentation](https://lichess-org.github.io/api/#tag/Opening-Explorer).

Useful database commands: `npm run db:push` and `npm run db:studio`.

## Current phase

The application includes persistent onboarding, saved PGN games, local Stockfish analysis, Lichess game syncing, opening repertoire management, recall training, spaced repetition, and a mastery dashboard. Explorer statistics identify whether they come from personal saved games, Lichess rated games, or the Lichess Masters database. See [docs/PROJECT_SPEC.md](docs/PROJECT_SPEC.md) for the product roadmap and [docs/HANDOFF.md](docs/HANDOFF.md) for implementation status.

## Public mode

KnightForge can run without accounts or database access with `GMB_SITE_MODE=public` for build and runtime. Visitors can replay games, use Stockfish, recall PGN opening lines, and solve sourced puzzles. Browser progress can be backed up and restored with JSON. See [Deployment](docs/DEPLOYMENT.md#knightforge-public-mode) for the route inventory and release checks.
