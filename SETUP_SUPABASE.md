# PayFlow ne Supabase (permanent database) sathe connect karvu

## Step 1 — Supabase project banavo
1. https://supabase.com par jaao → Sign up (GitHub thi login thai jashe)
2. **New Project** → name, DB password set karo (yaad rakhjo) → Region: Singapore (nearest)
3. 1-2 minute wait karo, project ready thai jashe

## Step 2 — Connection string levo
1. Project dashboard → **Settings** (gear icon) → **Database**
2. **Connection string** → **URI** tab
3. `[YOUR-PASSWORD]` ni jagya e tamaro actual password nakho
4. Aakho URL copy karo — kaink aavu dekhashe:
   `postgresql://postgres.xxxx:yourpassword@aws-0-xx.pooler.supabase.com:6543/postgres`

## Step 3 — Render par Environment Variable add karo
1. Render dashboard → `payflow` service → **Environment** tab
2. **Add Environment Variable**:
   - Key: `DATABASE_URL`
   - Value: (upar no connection string paste karo)
3. Save

## Step 4 — Naya files upload/push karo
Aa folder ni badhi files (`server.js`, `package.json`, `migrate-to-supabase.js`, `index.html`, `script.js`, `style.css`) tamara GitHub repo (`DasevDesigningStudio/Dasev-Design-Studio`) ma push karo — `server.js` ne replace karo, `package.json` ane `migrate-to-supabase.js` navi add karo.

```bash
git add .
git commit -m "Move data storage to Supabase (persistent)"
git push
```

Render auto-deploy start kari dese. Deploy logs ma jo "Payment Manager running on..." dekhay to sacess.

## Step 5 — Jubhi existing data (19 payments) Supabase ma move karo (EK VAAR j karvanu)
Tamara computer par (jya Node.js install hoy) terminal kholo, aa folder ma jaao, ane:

```bash
npm install
set DATABASE_URL=postgresql://postgres.xxxx:yourpassword@aws-0-xx.pooler.supabase.com:6543/postgres
npm run migrate
```

(Mac/Linux hoy to `set` na badle `export DATABASE_URL=...` vaparo)

Aa script tamara `data.json` (19 payments) ne Supabase ma copy kari dese. Success message aavse jem ke:
`✅ Inserted 19 payments and 0 expenses into Supabase.`

## Step 6 — Test karo
1. `https://payflow-o49g.onrender.com` kholo
2. Naye payment add karo
3. Page refresh karo → data haju pan dekhavu joiye ✅
4. Render service ne restart karo (Manual Deploy → Deploy latest commit) → data phir pan same rehvu joiye ✅

---

## Su badlaayu ane kem?
- Pehla: `data.json` file Render na server container ma save thato — jyare free instance spin down/restart thay, e file delete thai jati (data loss).
- Have: badho data Supabase na permanent PostgreSQL database ma save thay che (JSONB column ma, ek j row ma) — server restart thay to pan data safe rahe che.
- App no baaki no code (routes, logic) same j rahyo — fakt `loadData()`/`saveData()` functions have file na badle database vapare che.
