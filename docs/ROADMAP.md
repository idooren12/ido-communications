# משימות

## פתוח
- [ ] **לפני merge של PR התיקונים:** לוודא ש־`JWT_SECRET` מוגדר ב־Render (אחרת השרת לא יעלה), ולבדוק את ה־preview.
- [ ] להעביר את Render מ־`prisma db push` ל־`prisma migrate deploy`: פעם אחת `npx prisma migrate resolve --applied 0_init` מול Neon, ואז לשנות את פקודת ה־build ב־Render.
- [ ] להחליט על פתרון למכסת השעות ב־Render (ראה DECISIONS, 2026-10-05)
- [ ] שדרוג Prisma ל־8 (פגיעויות ב־CLI, ראה DECISIONS)
- [ ] `UnifiedMap.tsx` עדיין ~1,000 שורות: לפצל את ניהול השכבות והסמנים ל־hooks נפרדים
- [ ] streaming raster pipeline: Phase 2 (לא הוגדר. לברר מה תוכנן)

## בוצע
- [x] 2026-10-12: סקירת קוד ותיקון הממצאים (ענף `fix/review-findings`): deep links, תרגומים, אבטחת שרת, דיוק חישובים, באגים ב־DSM/PDF/שטח, 0 שגיאות tsc/ESLint, טסטים, CI, bundle
- [x] 2026-10-12: `client/README.md` אמיתי
- [x] 2026-10-05: קבצי זיכרון לפרויקט (CLAUDE.md + docs/)
