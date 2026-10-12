# משתני סביבה

שמות בלבד. **אף פעם לא ערכים.** דוגמה לפיתוח מקומי: `server/.env.example`.

## client (Vercel)
| שם | מטרה | איפה מוגדר |
|---|---|---|
| `VITE_API_URL` | כתובת ה־API ב־Render (בלי `/api`) | Vercel → Project Settings → Environment Variables |

## server (Render)
| שם | מטרה | איפה מוגדר |
|---|---|---|
| `DATABASE_URL` | חיבור ל־Neon Postgres | Render → `ido-communications-api` → Environment |
| `JWT_SECRET` | חתימת טוקנים. **חובה ב־production**: בלעדיו השרת לא עולה | Render |
| `FRONTEND_URL` | מקורות מורשים ל־CORS, מופרדים בפסיק. ברירת מחדל: `https://ido-communications.vercel.app`. כתובות preview של הפרויקט ב־Vercel מורשות תמיד | Render |
| `OPENWEATHERMAP_API_KEY` | נתוני מזג אוויר (`routes/weather.ts`) | Render |
| `PORT` | פורט, מוגדר אוטומטית ע"י Render | — |
| `RENDER` / `NODE_ENV` | `RENDER=true` (Render מגדיר לבד) או `NODE_ENV=production` מפעילים מצב production | — |
