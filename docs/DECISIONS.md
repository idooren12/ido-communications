# יומן החלטות

רשומות חדשות מתווספות למטה. לא מוחקים רשומות, רק מסמנים "הוחלף ב־...".

---

### 2026-02-07: פיצול Frontend / Backend בין Vercel ל־Render
- **החלטה:** ה־client ב־Vercel, ה־server (Express + Prisma) ב־Render, וה־DB ב־Neon.
- **למה:** שרת Express רגיל עם Prisma, ו־Render מריץ אותו כמו שהוא.
- **מחיר:** Render חינמי נרדם, ויש לו מכסת שעות משותפת לכל ה־workspace.

### 2026-02-07: הרצה עם `tsx` ב־production
- **החלטה:** `npm start` מריץ `tsx src/index.ts` ולא `tsc` + `node`.
- **למה:** בעיות build. לכן `tsx` נמצא ב־dependencies ולא ב־devDependencies.

### 2026-10-05: ריפו מפת הגבהים הישן (`idooren12/-`) הוחלף
- **החלטה:** מפת הגבהים של ישראל (Next.js) הוחלפה בפרויקט הזה, והריפו הישן נמחק.

### 2026-10-05: פתוח: מכסת השעות ב־Render
- `mc-admin-backend` מעיר את עצמו 24/7 ושורף כמעט את כל 750 השעות החודשיות של ה־workspace. אם המכסה נגמרת, Render משעה את **כל** השירותים החינמיים עד תחילת החודש.
- אפשרויות: להעביר את ה־server של הפרויקט הזה ל־Vercel Functions (Express נתמך), או לשדרג אחד השירותים לתוכנית בתשלום. טרם הוחלט.

### 2026-10-12: סקירת קוד ותיקון כל הממצאים
- **החלטה:** כל התיקונים נעשו בענף `fix/review-findings` ונכנסים דרך PR עם preview, לא ישירות ל־main.
- **למה:** push ל־main מעלה גם את Render, ושינויי השרת (JWT חובה, CORS) עלולים להפיל את ה־API אם משתנה סביבה חסר.

### 2026-10-12: אבטחת שרת
- **החלטה:** `JWT_SECRET` חובה ב־production (השרת יוצא אם חסר). CORS לפי רשימה (`FRONTEND_URL`, ברירת מחדל האתר החי) + כתובות preview של הפרויקט. rate limit על התחברות (20 ניסיונות כושלים ל־15 דקות), weather ו־/api. ולידציה עם zod. Express 5.
- **אלטרנטיבה שנדחתה:** מעבר מ־localStorage ל־httpOnly cookie. האתר (vercel.app) והשרת (onrender.com) בדומיינים שונים, אז זו עוגייה של צד שלישי ש־Safari ודפדפנים אחרים חוסמים. במקום זה נוסף CSP קשיח ב־`client/vercel.json` שמקטין את סיכון ה־XSS, וכל HTML דינמי במפה עובר escape.

### 2026-10-12: מודלים פיזיקליים
- **RF Safety:** מקדם החזרה מהקרקע 2.56 (FCC OET-65) מופעל כברירת מחדל; מתחת ל־30 MHz מסומן כקירוב; מחוץ ל־100 kHz–300 GHz שגיאה. אזהרת שדה קרוב.
- **מצב ריאליסטי:** גשם לפי ITU-R P.838-3, ערפל לפי P.840, אדי מים לפי P.676 (מפושט). צמחייה, בינוי, טופוגרפיה ואבק נשארו קירובים, ובממשק כתוב שזו הערכה.

### 2026-10-12: MapLibre 6
- **החלטה:** שדרוג ל־6.14 בגלל פגיעות XSS קריטית ב־5.x. v6 הוא ESM בלבד ודורש WebGL2 (כל הדפדפנים המודרניים).

### 2026-10-12: פגיעויות ב־Prisma CLI (הוחלף ב־"overrides" למטה)
- `npm audit` בשרת מדווח high על `prisma`/`@prisma/config` (תלויות של ה־CLI, רצות רק ב־build). התיקון דורש Prisma 8, שדרוג גדול. טרם בוצע.

### 2026-10-12: overrides במקום שדרוג Prisma
- **החלטה:** הפגיעויות ב־Prisma CLI (`effect`, `deepmerge-ts` דרך `@prisma/config`) נסגרו עם `overrides` ב־`server/package.json`, לא בשדרוג.
- **למה:** אף גרסה יציבה של Prisma עוד לא מתקנת אותן (7.10 פגיעה, 8 עדיין RC), ושדרוג ל־7/8 מחייב driver adapters ו־`prisma.config.ts`. `@prisma/config` משתמש רק ב־`deepmerge()`, שלא השתנה ב־deepmerge-ts 8.
- **לבדוק בעתיד:** כש־Prisma 8 יציא גרסה יציבה, לשדרג ולהסיר את ה־overrides.

### 2026-10-12: Node 24 בכל מקום
- `engines.node: 24.x` ב־client וב־server. Render בנה עד עכשיו על Node 22 (ברירת המחדל שלו), בזמן ש־Vercel ו־CI על 24.

### 2026-10-12: migrations במקום db push
- **החלטה:** `server/prisma/migrations` הוא מקור האמת לסכמה. ה־baseline `0_init` סומן כ־applied ב־Neon (נבדק: אין הבדל בין ה־DB לסכמה, והקובץ זהה לפלט של `migrate diff`).
- `directUrl = env("DIRECT_URL")`: ה־pooler של Neon (pgbouncer) לא מחזיק advisory locks של session, ש־`prisma migrate` צריך.
- **פתוח:** פקודת ה־build ב־Render עדיין מריצה `prisma db push` (לא ניתן לשנות אותה דרך הכלים שזמינים לי). צריך לשנות ידנית ב־Render ל־`npm install && npx prisma generate && npx prisma migrate deploy && npm run build`. עד אז שני המצבים עובדים (נבדק: `db push` מדווח "already in sync").

### 2026-10-12: פיצול UnifiedMap
- `UnifiedMap.tsx` (1,098 שורות) פוצל ל־`components/LOS/map/`: `mapSetup.ts` ו־hooks לפי תחום (חיפוש, מדידה, פוליגון גבהים, previews, תוצאות, raster). הקוד הועבר כמו שהוא, בלי שינוי התנהגות.

