# Ido Communications

פלטפורמה לחישובי תקשורת רדיו: מחשבון Friis, חישובי קו ראייה (LOS) על מפה עם נתוני גובה, השוואת תרחישים, בטיחות קרינה (RF Safety), וניהול אנטנות והיסטוריית חישובים למשתמש מחובר. ממשק בעברית ובאנגלית.

> בתחילת כל סשן: לקרוא את `docs/STATUS.md`, ואז `git log --oneline -15`. נוהל העבודה המלא בסקיל `long-project-workflow`.

## סטאק
- **client/**: React 19 + TypeScript + Vite, MapLibre GL 6, geotiff, recharts, jspdf, i18n (`src/i18n/he.json`, `en.json`). דפים נטענים lazy. `vercel.json`: rewrite ל־SPA + CSP.
- **server/**: Express 5 + TypeScript (מורץ עם `tsx`), Prisma, JWT, zod, helmet, rate limiting. `src/app.ts` בונה את האפליקציה, `src/config.ts` קורא env. נתיבים: `auth`, `antennas`, `history`, `weather`.
- **מסד נתונים**: Postgres ב־Neon (פרויקט `ido-communications`, eu-central-1). טבלאות: `User`, `Antenna`, `Calculation`.

## איפה זה רץ
| חלק | שירות | כתובת |
|---|---|---|
| Frontend | Vercel, פרויקט `ido-communications` | https://ido-communications.vercel.app |
| Backend | Render, שירות `ido-communications-api` (Frankfurt, free) | https://ido-communications-api.onrender.com |
| DB | Neon, פרויקט `ido-communications` | — |

- push ל־`main` מעלה גם את Vercel וגם את Render אוטומטית.
- Render בתוכנית חינמית נרדם אחרי 15 דקות בלי תעבורה. הבקשה הראשונה אחרי שינה לוקחת כחצי דקה עד דקה.
- ה־build ב־Render מריץ `prisma db push`, כלומר שינויי סכמה ב־`schema.prisma` נכנסים ל־production בכל deploy. להיזהר. יש baseline ב־`server/prisma/migrations/0_init` למעבר ל־`migrate deploy` (ראה ROADMAP).
- השרת לא עולה ב־production בלי `JWT_SECRET`.

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
