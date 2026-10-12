# משתני סביבה

שמות בלבד. **אף פעם לא ערכים.** דוגמה לפיתוח מקומי: `server/.env.example`.

## client (Vercel, פרויקט `ido-communications`)
| שם | מטרה | איפה מוגדר |
|---|---|---|
| `VITE_API_URL` | כתובת ה־API בלי `/api`. כרגע `https://ido-communications-api.vercel.app`. משתנה build, אז שינוי שלו דורש redeploy | Vercel → `ido-communications` → Settings → Environment Variables |

## server (Vercel, פרויקט `ido-communications-api`)
| שם | מטרה | מצב |
|---|---|---|
| `DATABASE_URL` | חיבור ל־Neon דרך ה־pooler (לאפליקציה) | הוגדר 2026-10-13 (Sensitive) |
| `DIRECT_URL` | חיבור ישיר ל־Neon (בלי `-pooler`), עבור `prisma migrate` | הוגדר 2026-10-13 (Sensitive) |
| `JWT_SECRET` | חתימת טוקנים. **חובה ב־production**: בלעדיו השרת לא עולה. נוצר חדש במעבר מ־Render | הוגדר 2026-10-13 (Sensitive) |
| `OPENWEATHERMAP_API_KEY` | נתוני מזג אוויר (`routes/weather.ts`). בלעדיו `/api/weather` מחזיר 503 וכל השאר עובד | **חסר**: משימה למשתמש, ראה `USER_TASKS.md` |
| `FRONTEND_URL` | מקורות מורשים ל־CORS, מופרדים בפסיק. ברירת מחדל: `https://ido-communications.vercel.app`. כתובות preview של הלקוח מורשות תמיד | לא מוגדר (ברירת המחדל מספיקה) |
| `VERCEL` / `NODE_ENV` | Vercel מגדיר לבד. `VERCEL=1` מפעיל מצב production | — |

## Render (ישן, עד הכיבוי)
אותם שמות בשירות `ido-communications-api` (`DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `FRONTEND_URL`, `OPENWEATHERMAP_API_KEY`). `RENDER=true` מפעיל שם מצב production.
