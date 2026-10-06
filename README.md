<div dir="rtl">

# מצפן — מערכת אישית לניהול משימות עם סוכן AI

**באוויר:** https://matzpen-five.vercel.app (כניסה בסיסמה)

מערכת משימות בעברית (RTL) עם מרחבים צבעוניים, שלוש תצוגות (קנבן, רשימה, לוח שנה), דשבורד של "מה בוער", וסוכן AI שקורא ומבצע פעולות — רק בתחום שנבחר לו, ולעולם לא פעולה רחבה או מחיקה בלי "כן".

## מה יש בה

- **מרחבים** — לכל מרחב צבע ותצוגה משלו; אפשר להחליף תצוגה בכל רגע.
- **קנבן** עם גרירה (עכבר, מגע, מקלדת). **רשימת TODO** לפי עדיפות, עם וי וביטול. **לוח שנה חודשי** בסגנון Google Calendar: לחיצה על יום יוצרת משימה, גרירה בין ימים משנה תאריך, מגירת "ללא תאריך".
- **דשבורד** — באיחור, להיום, דחוף; וכרטיס לכל מרחב: פתוחות, באיחור, נסגרו השבוע. בחירת המרחבים נשמרת.
- **סוכן** (OpenAI `gpt-6-luna`) עם 5 כלים: קריאה, הוספה, עדכון, מחיקה, סיכום.
  - **אכיפה בשרת:** תחום המרחבים שנבחר; פעולה על יותר מ-3 משימות או מחיקה מציגה כרטיס אישור; באישור מתבצעות בדיוק המשימות שהוצגו.
  - **תקרת תקציב קשיחה:** $1 לחודש (ניתן לשינוי). בהגעה לתקרה הסוכן נעצר עד החודש הבא, ושאר המערכת ממשיכה לעבוד.
- **אייפון** — מתקינים למסך הבית (שיתוף ← "הוסף למסך הבית") והמערכת נפתחת כאפליקציה במסך מלא.
- סיסמה אחת לכניסה, מצב כהה, עברית וערבית.
- **אבטחה:** נעילה אחרי 5 ניסיונות כניסה (וגם תקרה כללית נגד החלפת כתובות), בדיקת הרשאה בכל ממשק, חסימת בקשות ממקור חיצוני, וכותרות אבטחה.

## התקנה מקומית

```bash
npm ci
npm run dev:db               # Postgres מקומי (PGlite) על 127.0.0.1:54329 — בחלון נפרד
cp .env.example .env.local   # ולמלא: DATABASE_URL, OPENAI_API_KEY, APP_PASSWORD
npm run db:migrate
npm run db:seed              # נתוני דוגמה (seed/example.ts)
npm run dev
```

ל-Postgres המקומי: `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres` ו-`DB_POOL_MAX=1`.

## משתני סביבה

| משתנה | חובה | מה |
|---|---|---|
| `DATABASE_URL` | ✓ | חיבור Postgres. הטבלאות נוצרות בסכמה נפרדת `matzpen` |
| `OPENAI_API_KEY` | ✓ | מפתח OpenAI — בשרת בלבד |
| `APP_PASSWORD` | ✓ | הסיסמה לכניסה. החלפתה מנתקת את כל המכשירים |
| `SESSION_SECRET` | מומלץ | מחרוזת אקראית של 32 תווים ומעלה (`openssl rand -base64 32`). חותמת את עוגיית הכניסה, כך שעוגייה שדלפה לא מאפשרת לנחש את הסיסמה. החלפתה מנתקת את כל המכשירים |
| `OPENAI_MODEL` | — | ברירת מחדל `gpt-6-luna` |
| `AGENT_MONTHLY_BUDGET_USD` | — | תקרת הוצאה חודשית לסוכן. ברירת מחדל `1` |

## בדיקות

```bash
npm test            # לוגיקה, שכבת נתונים ואכיפת הסוכן — מול Postgres אמיתי בזיכרון
npm run typecheck
npm run check:secrets   # סריקת סודות — רצה אוטומטית לפני כל git push (‎.githooks/pre-push)
npm run e2e             # בדיקות קצה-לקצה בדפדפן (Playwright) — מול שרת רץ; BASE_URL=… לכתובת החיה
BASE_URL=https://… APP_PASSWORD=… node scripts/agent-acceptance.mjs   # 11 תרחישי קבלה מול המודל האמיתי
```

## שכפול ללקוח חדש

ראו [docs/CLONE.md](docs/CLONE.md) — שישה צעדים: קובץ הגדרות אחד (`src/config/instance.ts`), ומסד נתונים, סיסמה ומפתח משלו.

## מבנה

```
src/config/instance.ts   כל מה שאישי: שם, שעון, הנחיות לסוכן, תקציב
src/lib/domain.ts        עדיפויות, סטטוסים, צבעים — אוצר המילים המשותף
src/lib/dates.ts         היום / באיחור / השבוע לפי שעון ישראל
src/lib/repo.ts          שכבת הנתונים — הממשק והסוכן עוברים דרכה
src/lib/agent/           הסוכן: כלים, אכיפה, הנחיות, תקציב, לולאה
src/app/api/             ממשקי REST ו-/api/agent/* (NDJSON)
src/components/          הממשק: תצוגות, דשבורד, כרטיס משימה, צ'אט
```

Next.js 16, TypeScript, Tailwind v4, Drizzle + Postgres, OpenAI, dnd-kit, Vitest + PGlite.

</div>

---

**Matzpen** is a Hebrew (RTL) personal task manager with an AI agent: spaces with kanban / list / calendar views, a "what's burning" dashboard, and an OpenAI agent whose scope, confirmation rules (more than 3 tasks, or any delete) and monthly budget are enforced server-side. Built as a cloneable template — one config file per client. MIT licensed.
