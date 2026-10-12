# משימות

## פתוח
- [ ] **ידני ב־Render:** לשנות את ה־Build Command של `ido-communications-api` ל־`npm install && npx prisma generate && npx prisma migrate deploy && npm run build` (ה־baseline כבר מסומן ב־Neon, `DIRECT_URL` כבר מוגדר)
- [ ] להחליט על פתרון למכסת השעות ב־Render (ראה DECISIONS, 2026-10-05)
- [ ] כש־Prisma 8 יציב: לשדרג ולהסיר את ה־`overrides` (ראה DECISIONS)
- [ ] streaming raster pipeline: Phase 2 (לא הוגדר. לברר מה תוכנן)

## בוצע
- [x] 2026-10-12: Node 24 בכל מקום; 0 פגיעויות ב־npm audit (overrides ל־Prisma CLI, vitest 5)
- [x] 2026-10-12: baseline של migrations סומן ב־Neon, `directUrl`/`DIRECT_URL`
- [x] 2026-10-12: פיצול `UnifiedMap.tsx` ל־hooks ב־`components/LOS/map/`
- [x] 2026-10-12: PR #1 מוזג ועלה ל־production, נבדק מול האתר וה־API החיים
- [x] 2026-10-12: סקירת קוד ותיקון הממצאים (ענף `fix/review-findings`): deep links, תרגומים, אבטחת שרת, דיוק חישובים, באגים ב־DSM/PDF/שטח, 0 שגיאות tsc/ESLint, טסטים, CI, bundle
- [x] 2026-10-12: `client/README.md` אמיתי
- [x] 2026-10-05: קבצי זיכרון לפרויקט (CLAUDE.md + docs/)
