# מצב נוכחי

_עודכן: 2026-10-12_

## איפה עומדים
כל ממצאי סקירת הקוד מ־2026-10-12 תוקנו בענף `fix/review-findings`, שנמצא ב־PR מול `main`. ה־PR עוד לא מוזג, כך שה־production עדיין רץ על הקוד הישן.

## מה השתנה בענף
- **באגים:** רענון או קישור ישיר לדף החזיר 404 (נוסף `client/vercel.json`); 20 מפתחות תרגום חסרים; התנתקות כשהשרת ישן; העלאת DSM לא עבדה בכלל; שטח בדונם היה קטן פי 10; דוח ה־PDF הציג dBm כ־W וגברים שגויים; טקסט עברי קשיח במפה.
- **אבטחה:** `JWT_SECRET` חובה, CORS לפי רשימה, rate limiting, helmet, ולידציה (zod), escape ל־HTML בחלונות המפה, CSP, MapLibre 6 (פגיעות XSS קריטית).
- **חישובים:** RF Safety עם החזרה מהקרקע ובדיקת טווח ICNIRP; גשם/ערפל/אדי מים לפי ITU-R; אחוז הפחתה תקין במצב הספק.
- **איכות:** 0 שגיאות tsc ו־ESLint (היו 63 ו־124), ה־build ב־Vercel מריץ tsc, 79 טסטים, CI ב־GitHub Actions.
- **ביצועים:** JS בדף הבית ירד מ־1.16MB ל־340KB.

## הצעד הבא
1. לוודא ב־Render ש־`JWT_SECRET` מוגדר בשירות `ido-communications-api`. בלעדיו השרת החדש לא יעלה.
2. לבדוק את ה־preview של ה־PR (deep links, מפה, DSM, RF Safety, PDF).
3. merge ל־`main`. זה מעלה את Vercel ואת Render.
4. אחרי ה־merge: לבדוק את האתר החי והתחברות.

## ידוע / פתוח
- ה־preview ב־Vercel מדבר עם שרת ה־production ב־Render, שעדיין רץ על הקוד הישן עד ה־merge. אם `FRONTEND_URL` מוגדר שם, ה־CORS הישן יחסום קריאות API מכתובת ה־preview (תקין, ייפתר אחרי ה־merge).
- Render: מכסת שעות משותפת (ראה DECISIONS 2026-10-05), ועדיין `prisma db push` במקום migrations (ראה ROADMAP).
- `npm audit` בשרת: פגיעויות ב־Prisma CLI (build בלבד), דורש Prisma 8.
- `UnifiedMap.tsx` עדיין גדול (~1,000 שורות).
