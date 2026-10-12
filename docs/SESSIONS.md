# יומן סשנים

- **2026-10-05**: סידור חשבונות. נוספו CLAUDE.md ו־docs/. נבדק שהאתר והשרת חיים. אין שינוי בקוד.
- **2026-10-12**: סקירת קוד מלאה ותיקון כל הממצאים בענף `fix/review-findings` (PR). 79 טסטים (54 client, 25 server), CI, MapLibre 6.
- **2026-10-12 (המשך)**: נבדקו Render (JWT_SECRET מוגדר) וה־preview בדפדפן headless; נמצא ותוקן באג ב־worker של MapLibre 6; PR #1 מוזג ועלה, ונבדק מול production.
- **2026-10-12 (המשך 2)**: PR #2: Node 24, 0 פגיעויות (overrides ל־Prisma CLI, vitest 5), `DIRECT_URL` + baseline מסומן ב־Neon, פיצול `UnifiedMap.tsx`. מוזג ונבדק ב־production.
