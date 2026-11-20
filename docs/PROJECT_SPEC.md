# KnightForge — Project specification

## Product goal

Help a player rated approximately 1800 Lichess Classical make a deliberate, evidence-based improvement toward the Candidate Master title: 2200 FIDE Standard. The application is a private local-first training workspace. Ratings and training insights must be sourced from the player's records or clearly labeled sample data; the app must never invent chess moves, engine evaluations, or performance statistics.

## Foundation

- Next.js App Router, TypeScript, and Tailwind CSS responsive interface.
- Professional dark navy and charcoal visual system with restrained purple accents.
- Persistent local SQLite storage accessed through Prisma.
- Persistent player profile and settings, including current rating pool, rating, weekly study target, preferred side, and Candidate Master goal.
- First-run onboarding that accepts the player's starting point and stores it locally.
- Responsive sidebar and working navigation across all product areas.
- Free/local workflows preferred. External integrations must keep credentials server-side and optional.

## Intended navigation and features

1. **Dashboard** — profile baseline, goal progress based on recorded rating data, weekly training plan, study activity, and links to priority tasks. Empty states must remain explicit until the user records activity.
2. **Games** — import/export PGN, locally save games, search and filter by date, opening, color, result, and time control; allow a later optional Lichess sync.
3. **Analysis** — inspect a game on a legal chessboard, annotate positions, identify critical moments, and request local Stockfish analysis. Engine output must be labeled with the engine and settings used.
4. **Openings** — maintain White and Black repertoire trees, attach source games and notes, and practice recall with spaced repetition.
5. **Tactics** — solve positions from a verified puzzle source or user games, track attempts and themes, and adapt practice using recorded results.
6. **Calculation** — candidate-move and line-entry workspace with optional timers, reveal controls, and review journal. Solutions must come from sourced positions.
7. **Strategy** — study pawn structures, plans, piece placement, and annotated positions with references and source attribution.
8. **Endgames** — theoretical and practical endgame practice, with sourced positions and optional tablebase verification where available.
9. **OTB Training** — classical time-management routines, tournament preparation checklist, focus notes, and round-by-round review.
10. **Coach** — use the player's actual games, goals, and time budget to propose a transparent weekly plan with editable priorities.
11. **Progress** — rating history, training consistency, theme-level results, and goal tracking derived from recorded sessions. Label rating pools and date ranges.

## Later integrations

- **chess.js** and a maintained React chessboard component for legal move interaction and board display.
- **Stockfish** for optional local engine review; default to local/free operation and make engine configuration visible.
- **Lichess private sync** uses explicit authorization and server-side token handling. The no-login public workspace may import public games directly from Lichess into the visitor's browser-local library without a token. No API secrets in browser code or committed files.

## Delivery phases

- **Phase 1 — Foundation (current):** application shell, styling, navigation, profile onboarding, SQLite/Prisma initialization, and project documentation.
- **Phase 2 — Game record:** PGN import, local game storage, and basic game browsing.
- **Phase 3 — Analysis:** board interaction, notes, and local engine workflow.
- **Phase 4 — Training tools:** opening recall, tactics, calculation, strategy, and endgame workflows.
- **Phase 5 — Planning and progress:** editable coach plan, OTB workflow, metrics, and optional Lichess integration.

Each request should implement only its requested feature or phase, update `docs/HANDOFF.md`, run relevant checks, and stop when complete.
