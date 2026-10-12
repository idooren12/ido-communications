# מצב נוכחי

_עודכן: 2026-10-12_

## איפה עומדים
PR #1 (תיקוני סקירת קוד) ו־PR #2 (צעדי ה־ROADMAP) מוזגו ל־`main` ועלו ל־production ב־2026-10-12.

## מה עובד ונבדק
- Render בונה על Node 24.21, `npm audit` מחזיר 0, ה־API עלה תקין. `db push` רץ דרך `DIRECT_URL` ומדווח שהסכמה מסונכרנת.
- Vercel: האתר החי נבדק בדפדפן headless גם מול ה־preview של PR #2 וגם מול production, עם תוצאות זהות: המפה נטענת, כלי המדידה עובד (80.90 ק"מ, 110.9°), חיפוש קואורדינטות מוסיף סמן, ואין שגיאות קונסול או הפרות CSP.
- Neon: ה־baseline `0_init` מסומן כ־applied ו־`prisma migrate status` מחזיר "up to date".

## הצעד הבא
1. **ידני ב־Render** (אין לי גישה להגדרות ה־build): בשירות `ido-communications-api` → Settings → Build Command, להחליף ל־
   `npm install && npx prisma generate && npx prisma migrate deploy && npm run build`
2. החלטה פתוחה: מכסת השעות ב־Render (ראה DECISIONS 2026-10-05). אפשרויות: להעביר את ה־API ל־Vercel Functions, או לשדרג את Render.

## ידוע / פתוח
- חיפוש מקומות דרך Nominatim לא נבדק אוטומטית: Nominatim חוסם כתובות IP של מרכזי נתונים, כולל ה־sandbox. חיפוש קואורדינטות נבדק ועובד.
- הפופאפ של תוצאת חיפוש לא הופיע בבדיקה האוטומטית, אף שהסמן נוסף. ההתנהגות זהה ל־production שלפני הפיצול, אז זו לא רגרסיה. שווה לבדוק ידנית.
