# משתני סביבה

שמות בלבד. **אף פעם לא ערכים.**

## client (Vercel)
| שם | מטרה | איפה מוגדר |
|---|---|---|
| `VITE_API_URL` | כתובת ה־API ב־Render | Vercel → Project Settings → Environment Variables |

## server (Render)
| שם | מטרה | איפה מוגדר |
|---|---|---|
| `DATABASE_URL` | חיבור ל־Neon Postgres | Render → `ido-communications-api` → Environment |
| `JWT_SECRET` | חתימת טוקנים של התחברות | Render |
| `FRONTEND_URL` | כתובת ה־client, עבור CORS | Render |
| `OPENWEATHERMAP_API_KEY` | נתוני מזג אוויר (`routes/weather.ts`) | Render |
| `PORT` | פורט, מוגדר אוטומטית ע"י Render | — |
