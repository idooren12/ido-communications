# Ido Communications

פלטפורמה לחישובי תקשורת רדיו: מחשבון Friis, חישובי קו ראייה (LOS) על מפה עם נתוני גובה, השוואת תרחישים, בטיחות קרינה (RF Safety), וניהול אנטנות והיסטוריית חישובים למשתמש מחובר. ממשק בעברית ובאנגלית.

> בתחילת כל סשן: לקרוא את `docs/STATUS.md`, ואז `git log --oneline -15`. נוהל העבודה המלא בסקיל `long-project-workflow`.

## סטאק
- **client/**: React + TypeScript + Vite, MapLibre GL, geotiff, recharts, jspdf, i18n (`src/i18n/he.json`, `en.json`).
- **server/**: Express + TypeScript (מורץ עם `tsx`), Prisma, JWT. נתיבים: `auth`, `antennas`, `history`, `weather`.
- **מסד נתונים**: Postgres ב־Neon (פרויקט `ido-communications`, eu-central-1). טבלאות: `User`, `Antenna`, `Calculation`.

## איפה זה רץ
| חלק | שירות | כתובת |
|---|---|---|
| Frontend | Vercel, פרויקט `ido-communications` | https://ido-communications.vercel.app |
| Backend | Render, שירות `ido-communications-api` (Frankfurt, free) | https://ido-communications-api.onrender.com |
| DB | Neon, פרויקט `ido-communications` | — |

- push ל־`main` מעלה גם את Vercel וגם את Render אוטומטית.
- Render בתוכנית חינמית נרדם אחרי 15 דקות בלי תעבורה. הבקשה הראשונה אחרי שינה לוקחת כחצי דקה עד דקה.
- ה־build ב־Render מריץ `prisma db push`, כלומר שינויי סכמה ב־`schema.prisma` נכנסים ל־production בכל deploy. להיזהר.

## הרצה מקומית
```bash
npm run install:all
docker compose up -d   # Postgres מקומי
npm run dev            # client + server יחד
```

## משתני סביבה
ראה `docs/ENV.md`. אין לשמור ערכים בקוד או בריפו.

## מסמכים
- `docs/STATUS.md`: מצב נוכחי וצעד הבא
- `docs/DECISIONS.md`: החלטות והסיבות להן
- `docs/ROADMAP.md`: משימות פתוחות
- `docs/SESSIONS.md`: יומן סשנים
- `docs/ENV.md`: משתני סביבה
