# מצב נוכחי

_עודכן: 2026-10-12_

## איפה עומדים
תיקוני סקירת הקוד (PR #1) מוזגו ל־`main` ב־2026-10-12 ועלו ל־production: Vercel (האתר) ו־Render (ה־API).

## מה נבדק אחרי העלייה (2026-10-12, דפדפן headless מול האתר החי)
- API: ‏`/health` תקין; טוקן מזויף נדחה (401); CORS מאשר רק את האתר (מקור זר מקבל 200 בלי `Access-Control-Allow-Origin`); הגבלת ניסיונות התחברות פעילה (20 ל־15 דקות); weather דוחה קואורדינטות לא חוקיות ומחזיר נתונים תקינים; 404 ב־JSON; כותרות helmet.
- אתר: ‏`/friis`, `/rf-safety`, `/los` (המפה נטענת), `/compare`, `/login` נטענים ישירות (deep links), בלי שגיאות קונסול ובלי הפרות CSP.

## מה השתנה (סיכום)
- באגים: deep links (404), 20 מפתחות תרגום, התנתקות כשהשרת ישן, העלאת DSM לא עבדה, דונם פי 10, PDF עם ערכים שגויים, worker של MapLibre 6.
- אבטחה: JWT חובה, CORS, rate limiting, helmet, zod, escape ל־HTML במפה, CSP, MapLibre 6.
- חישובים: RF Safety עם החזרה מהקרקע ובדיקת טווח ICNIRP; ITU-R לגשם, ערפל ואדי מים.
- איכות: 0 שגיאות tsc/ESLint, 79 טסטים, CI.

## הצעד הבא
לא הוגדר. אפשרויות מ־ROADMAP: מעבר Render ל־`prisma migrate deploy`, שדרוג Prisma 8, פיצול `UnifiedMap.tsx`, ופתרון למכסת השעות ב־Render.

## ידוע / פתוח
- Render רץ על Node 22 (ברירת מחדל של Render), Vercel על Node 24. כדאי לקבע גרסה (`engines` ב־`server/package.json`).
- פקודת ה־build ב־Render עדיין `prisma db push` (ראה ROADMAP).
- `npm audit` בשרת: 4 high ב־Prisma CLI (build בלבד).
- `UnifiedMap.tsx` עדיין ~1,000 שורות.
