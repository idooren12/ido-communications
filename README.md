# Ido Communications

Radio-communication planning tools (Hebrew / English):

- **Friis calculator** — maximum range or received power, with an optional "realistic" mode
  (Israeli regions + live weather; rain/fog/water-vapour from ITU-R models).
- **Line of sight (LOS)** on a map with terrain data: point-to-point (optical / RF with Fresnel
  zone), area coverage (streamed to a raster for very large grids), peak finder, custom DSM upload,
  local projects.
- **RF safety distance** (ICNIRP 2020 limits, OET-65 ground reflection).
- Accounts: saved antennas and calculation history.

Live: https://ido-communications.vercel.app

## Structure

| Folder | What | Hosted on |
|---|---|---|
| `client/` | React 19 + TypeScript + Vite, MapLibre GL, Tailwind, i18next | Vercel (root directory `client`) |
| `server/` | Express 5 + TypeScript (run with `tsx`), Prisma, JWT, zod | Render (`ido-communications-api`) |
| — | PostgreSQL | Neon (`ido-communications`, eu-central-1) |

## Running locally

```bash
npm run install:all
docker compose up -d        # local Postgres
cp server/.env.example server/.env   # then fill in values (see docs/ENV.md)
cd server && npx prisma migrate deploy && cd ..
npm run dev                 # client on :5173, API on :3001 (proxied at /api)
```

## Checks

```bash
cd client && npm run typecheck && npm run lint && npm test && npm run build
cd server && npm run typecheck && npm test
```

CI (`.github/workflows/ci.yml`) runs the same on every push and pull request.

More detail for maintainers: `CLAUDE.md` and `docs/`.
