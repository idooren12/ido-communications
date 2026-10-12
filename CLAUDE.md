# Ido Communications

פלטפורמה לחישובי תקשורת רדיו: מחשבון Friis, חישובי קו ראייה (LOS) על מפה עם נתוני גובה, השוואת תרחישים, בטיחות קרינה (RF Safety), וניהול אנטנות והיסטוריית חישובים למשתמש מחובר. ממשק בעברית ובאנגלית.

> בתחילת כל סשן: לקרוא את `docs/STATUS.md`, ואז `git log --oneline -15`. נוהל העבודה המלא בסקיל `long-project-workflow`.
> משימות שרק המשתמש יכול לעשות (מפתחות, מחיקת שירותים, בדיקות ידניות) נמצאות ב־`docs/USER_TASKS.md`, כשלבים שאפשר לעשות מהטלפון. כל משימה כזו נכנסת לשם, ולא רק לצ'אט.

## סטאק
- **client/**: React 19 + TypeScript + Vite, MapLibre GL 6, geotiff, recharts, jspdf, i18n (`src/i18n/he.json`, `en.json`). דפים נטענים lazy. `vercel.json`: rewrite ל־SPA + CSP.
- **server/**: Express 5 + TypeScript, Prisma, JWT, zod, helmet, rate limiting. `src/app.ts` בונה את האפליקציה, `src/config.ts` קורא env. נתיבים: `auth`, `antennas`, `history`, `weather`. ב־Vercel: `api/index.ts` מייצא את האפליקציה כ־Function, ו־`vercel.json` מפנה אליה את כל הנתיבים. מקומית: `src/index.ts` (`app.listen`).
- **מסד נתונים**: Postgres ב־Neon (פרויקט `ido-communications`, eu-central-1). טבלאות: `User`, `Antenna`, `Calculation`.

## איפה זה רץ
| חלק | שירות | כתובת |
|---|---|---|
| Frontend | Vercel, פרויקט `ido-communications` (root: `client`) | https://ido-communications.vercel.app |
| Backend | Vercel, פרויקט `ido-communications-api` (root: `server`, Functions ב־fra1) | https://ido-communications-api.vercel.app |
| DB | Neon, פרויקט `ido-communications` (eu-central-1) | — |
| ישן | Render, שירות `ido-communications-api`. לא בשימוש מאז 2026-10-13, ממתין לכיבוי (USER_TASKS) | https://ido-communications-api.onrender.com |

- push ל־`main` מעלה את שני פרויקטי Vercel (וכל עוד הוא קיים, גם את Render). ענף אחר: preview לשניהם.
- הלקוח מגיע ל־API דרך `VITE_API_URL` (משתנה build ב־Vercel). שינוי שלו דורש build חדש של הלקוח.
- **סכמה:** ב־Vercel לא רצות migrations ב־build. שינוי ב־`schema.prisma` מחייב migration חדשה ב־`server/prisma/migrations` והרצה ידנית של `prisma migrate deploy` עם `DIRECT_URL` (או SQL דרך Neon). כל עוד Render קיים, ה־build שלו עדיין מריץ `prisma db push`, אז להיזהר.
- השרת לא עולה ב־production בלי `JWT_SECRET`.
- rate limiting בזיכרון של כל instance (ב־Vercel יכולים להיות כמה), אז המגבלות הן לכל instance. מספיק לתעבורה הנוכחית.

## הרצה מקומית
```bash
npm run install:all
docker compose up -d   # Postgres מקומי
npm run dev            # client + server יחד
```

## בדיקות
- client: `npm run typecheck && npm run lint && npm test && npm run build` (כל אלה חייבים לעבור, ה־build ב־Vercel מריץ גם tsc).
- server: `npm run typecheck && npm test` (Prisma מוחלף ב־mock, לא צריך DB).
- CI ב־`.github/workflows/ci.yml` מריץ את שניהם על כל push ו־PR.
- כל טקסט למשתמש עובר דרך i18n; טסט נכשל אם מפתח חסר או לא קיים בשתי השפות.

## משתני סביבה
ראה `docs/ENV.md`. אין לשמור ערכים בקוד או בריפו.

## מסמכים
- `docs/STATUS.md`: מצב נוכחי וצעד הבא
- `docs/DECISIONS.md`: החלטות והסיבות להן
- `docs/ROADMAP.md`: משימות פתוחות
- `docs/SESSIONS.md`: יומן סשנים
- `docs/ENV.md`: משתני סביבה
- `docs/USER_TASKS.md`: משימות שרק המשתמש יכול לעשות
