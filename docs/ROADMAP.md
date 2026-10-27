# משימות

## פתוח
- [ ] **משתמש:** `OPENWEATHERMAP_API_KEY` ב־Vercel, ואז לכבות את Render (ראה `USER_TASKS.md`)
- [ ] אחרי כיבוי Render: להסיר `*.onrender.com` מה־CSP ואת `RENDER` מ־`config.ts`
- [ ] migrations אוטומטיות: job ב־CI שמריץ `prisma migrate deploy` על main (דורש secret של `DIRECT_URL` ב־GitHub)
- [ ] rate limiting משותף בין instances של Vercel (Postgres או Redis), אם התעבורה תגדל
- [ ] כלי השטח: viewshed רדיאלי (R2/XDraw) במקום קרן מלאה לכל תא, אם חישובים גדולים יהיו איטיים מדי
- [ ] מקור גובה טוב יותר מ־SRTM (Copernicus GLO-30 כאריחי Terrarium משלנו)
- [ ] בדיקה ידנית של העלאת GeoTIFF אמיתי ב־ITM מול שכבת תצלום (ראה USER_TASKS)
- [ ] כש־Prisma 8 יציב: לשדרג ולהסיר את ה־`overrides` (ראה DECISIONS)
- [ ] streaming raster pipeline: Phase 2 (לא הוגדר. לברר מה תוכנן)

## בוצע
- [x] 2026-10-27: דיוק LOS (ענף `los-accuracy-fixes`): דאטום ITM/ICS/UTM, מעגל גדול, זום 12 עד ~80 ק"מ, פס אי ודאות, k לפי מצב, מפת שטח במקום, DSM לפי GeoKeys ודגימה צפופה בתוכו, תיקון העלאה דרך בורר הקבצים. 152 טסטים בצד הלקוח
- [x] 2026-10-13: ה־API עבר ל־Vercel Functions (`ido-communications-api`); נבדק מול האתר החי
- [x] 2026-10-13: מודל LOS אחד לקו ולשטח (PR #3): ברירות מחדל זהות, בילינארי, מחלקות fresnel/marginal, DSM ב־workers
- [x] 2026-10-12: Node 24 בכל מקום; 0 פגיעויות ב־npm audit (overrides ל־Prisma CLI, vitest 5)
- [x] 2026-10-12: baseline של migrations סומן ב־Neon, `directUrl`/`DIRECT_URL`
- [x] 2026-10-12: פיצול `UnifiedMap.tsx` ל־hooks ב־`components/LOS/map/`
- [x] 2026-10-12: PR #1 מוזג ועלה ל־production, נבדק מול האתר וה־API החיים
- [x] 2026-10-12: סקירת קוד ותיקון הממצאים (ענף `fix/review-findings`): deep links, תרגומים, אבטחת שרת, דיוק חישובים, באגים ב־DSM/PDF/שטח, 0 שגיאות tsc/ESLint, טסטים, CI, bundle
- [x] 2026-10-12: `client/README.md` אמיתי
- [x] 2026-10-05: קבצי זיכרון לפרויקט (CLAUDE.md + docs/)
