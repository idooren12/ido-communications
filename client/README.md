# Client

React + TypeScript + Vite front end of Ido Communications. See the root `README.md`.

| Command | |
|---|---|
| `npm run dev` | Dev server (proxies `/api` to `localhost:3001`) |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint (0 errors expected) |
| `npm test` | Vitest — calculations, units, API errors, translations, popups |
| `npm run build` | Typecheck + production build to `dist/` |

- Pages are lazy-loaded (`src/App.tsx`); MapLibre lives in its own chunk and loads only on `/los`.
- All user-facing text goes through `src/i18n/{he,en}.json`; a test fails if a key is missing.
- `vercel.json` holds the SPA rewrite (deep links) and security headers / CSP. If you add a new
  external tile/API host, add it to the CSP `connect-src` / `img-src` there.
- Environment: `VITE_API_URL` (API base URL, without `/api`).
