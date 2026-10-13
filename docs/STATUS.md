# מצב נוכחי

_עודכן: 2026-10-13_

## איפה עומדים
- **ה־API עבר ל־Vercel** (PR #4): פרויקט `ido-communications-api`, https://ido-communications-api.vercel.app, Functions ב־fra1. האתר החי פונה אליו דרך `VITE_API_URL`. Render עדיין רץ כגיבוי, אבל אף אחד לא משתמש בו.
- **מודל LOS אחד לקו ולשטח** (PR #3): ברירות מחדל זהות (10/2 מ׳), אינטרפולציה בילינארית, אותה דגימה ואותו זום, מחלקות חדשות (צהוב: פרנל חסום, כתום: חסום בפחות מ־3 מ׳). פרטים ב־DECISIONS.

## מה נבדק
- API החדש ב־production: `/health` 200, login שגוי מחזיר 401 מה־DB (כ־0.4 שניות), preflight של CORS מהאתר החי תקין, ו־`/api/antennas` בלי טוקן מחזיר 401.
- LOS ב־preview בדפדפן headless: ה־worker של השטח נטען כמודול, מופיעות המחלקות החדשות (בירושלים, 0–2 ק"מ: 428 פנוי / 143 גבולי / 674 חסום), כלי הקו מציג את כל הסטטוסים, ואין שגיאות קונסול או הפרות CSP.

## הצעד הבא
1. **משתמש** (`USER_TASKS.md`): להוסיף `OPENWEATHERMAP_API_KEY` ל־`ido-communications-api` ב־Vercel. עד אז `/api/weather` מחזיר 503.
2. **משתמש:** לכבות את Render (Suspend), אחרי שמזג האוויר עובד.
3. אחרי הכיבוי: להסיר `*.onrender.com` מה־CSP ואת `RENDER` מ־`config.ts`.

## ידוע / פתוח
- `JWT_SECRET` חדש ב־Vercel, אז כל משתמש מתחבר מחדש פעם אחת.
- חיפוש מקומות דרך Nominatim לא נבדק אוטומטית: Nominatim חוסם IP של מרכזי נתונים. בדיקה ידנית נמצאת ב־USER_TASKS.
- rate limiting בזיכרון של כל instance (ראה DECISIONS).
