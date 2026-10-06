<div dir="rtl">

# שכפול מצפן ללקוח חדש

כל לקוח מקבל עותק עצמאי: פריסה משלו, מסד נתונים משלו, סיסמה משלו ומפתח AI משלו. אין נתונים משותפים בין לקוחות.

## שישה צעדים

**1. עותק של הקוד**
יוצרים ריפו חדש מהקוד הזה (Fork או "Use this template"), בשם הלקוח — למשל `matzpen-alhadaf`.

**2. קובץ ההגדרות — `src/config/instance.ts`**
זה הקובץ היחיד שמשתנה:

| שדה | מה לשים |
|---|---|
| `productName` | שם המערכת אצל הלקוח (מופיע בכניסה, בתפריט ובאייקון) |
| `tagline` | שורה אחת מתחת לשם |
| `ownerName` | שם המשתמש הראשי |
| `timeZone` | `Asia/Jerusalem` לרוב |
| `agentPersona` | 2–3 שורות לסוכן: מי הלקוח, באיזה תחום, באיזו שפה לענות |
| `agentMonthlyBudgetUsd` | תקרת ההוצאה החודשית של הסוכן |

צבעי מותג (לא חובה): הערכים בראש `src/app/globals.css` — `--ink` (צבע המבנה) ו-`--brass` (צבע ההדגשה).

**3. נתוני פתיחה**
מעתיקים את `seed/example.ts` ל-`seed/private/owner.ts` (הקובץ לא עולה לגיטהאב) וכותבים את המרחבים והמשימות של הלקוח.

**4. מסד נתונים**
בחשבון Vercel של הלקוח: Storage → Create Database → Postgres (המסלול החינמי). מעתיקים את `DATABASE_URL` לקובץ `.env` מקומי, ואז:

```bash
npm ci
npm run db:migrate
npm run db:seed
```

**5. פריסה**
ב-Vercel: New Project → מחברים את הריפו → מגדירים את המשתנים: `DATABASE_URL` (הכתובת עם `-pooler`), `OPENAI_API_KEY` (של הלקוח), `APP_PASSWORD`, ו-`SESSION_SECRET` (מחרוזת אקראית חדשה לכל לקוח: `openssl rand -base64 32`) → Deploy.

**6. בדיקה ומסירה**

```bash
BASE_URL=https://<הכתובת> APP_PASSWORD=<הסיסמה> node scripts/agent-acceptance.mjs
```

כל 11 התרחישים צריכים לעבור. מוסרים ללקוח את הכתובת, את הסיסמה (בערוץ נפרד) ואת מדריך השימוש.

## עלויות ללקוח

| רכיב | עלות |
|---|---|
| Vercel Hobby | חינם — לשימוש אישי/לא מסחרי. לשימוש עסקי מובהק: Vercel Pro $20 לחודש |
| Postgres (Neon דרך Vercel, מסלול חינמי) | חינם — עד 0.5GB, מספיק לעשרות אלפי משימות |
| OpenAI | לפי שימוש, עם תקרה קשיחה בקובץ ההגדרות |

</div>
