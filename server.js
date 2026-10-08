/* ============================================================================
   PayFlow — Payment Manager
   Backend server (Express.js)
   ============================================================================ */

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Static files (index.html, style.css, script.js, etc.)
/* ---------------------------------------------------------------------- */
/* Users, login, roles                                                    */
/* - Darek member no potano login (email + password), hash thai ne store  */
/* - Roles ni access table (deny by default) neeche ACCESS ma che         */
/* - APP_PASSWORD have fakt pehli vaar "Owner account" banava mate        */
/* ---------------------------------------------------------------------- */

const crypto = require("crypto");
const { promisify } = require("util");
const { AsyncLocalStorage } = require("async_hooks");
const scryptAsync = promisify(crypto.scrypt);

app.set("trust proxy", 1);
app.use(express.urlencoded({ extended: false }));

const APP_PASSWORD = process.env.APP_PASSWORD || "";
// SESSION_SECRET Render ma alag set karvu best che. Na hoy to fallback vaparay che.
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  APP_PASSWORD ||
  crypto.createHash("sha256").update("aos:" + (process.env.DATABASE_URL || "dev")).digest("hex");
const COOKIE_NAME = "aos_session";
const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET set nathi — Render Environment ma ek lambo random SESSION_SECRET umero.");
}

/* ---------- Roles & access (deny by default) -------------------------- */
const F = "full";
const V = "view";
const CREATIVE = { calendar: F, clients: V }; // Editor / Designer / Shooter / SM

const ACCESS = {
  owner:    { dashboard: F, calendar: F, clients: F, payments: F, leads: F, expenses: F, reports: F, backup: F, settings: F, team: F, activity: F, work: F },
  manager:  { dashboard: F, calendar: F, clients: F, payments: F, leads: F, expenses: F, reports: F, activity: V, work: F },
  sales:    { calendar: F, clients: F, leads: F, work: V },
  finance:  { dashboard: F, calendar: V, clients: V, payments: F, expenses: F, reports: F },
  editor:   { ...CREATIVE, work: F },
  designer: { ...CREATIVE, work: F },
  shooter:  { ...CREATIVE, work: F },
  sm:       { ...CREATIVE, work: F },
  viewer:   { calendar: V, clients: V, leads: V, work: V }
};
const ROLES = Object.keys(ACCESS);

function accessLevel(role, module) {
  return (ACCESS[role] && ACCESS[role][module]) || null;
}
function canMoney(role) {
  return !!accessLevel(role, "payments");
}

const AUTH = "__auth__"; // koi pan logged-in user (read-only reference data)
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const getOr = (module) => (req) => (SAFE_METHODS.has(req.method) ? AUTH : module);
const getOrElse = (readModule, writeModule) => (req) => (SAFE_METHODS.has(req.method) ? readModule : writeModule);

// Je route aa list ma nathi e BAND (403).
const ROUTE_RULES = [
  [/^\/me$/, () => AUTH],
  [/^\/settings$/, getOr("settings")],
  [/^\/categories(\/|$)/, getOr("payments")],
  [/^\/platform-options$/, getOr("settings")],
  [/^\/lead-sources$/, getOr("leads")],
  [/^\/expense-categories$/, getOr("expenses")],
  [/^\/payments(\/|$)/, () => "payments"],
  [/^\/expenses(\/|$)/, () => "expenses"],
  [/^\/dashboard$/, () => "dashboard"],
  [/^\/overview$/, () => "dashboard"],
  [/^\/calendar(-events)?(\/|$)/, () => "calendar"],
  [/^\/clients(\/|$)/, () => "clients"],
  [/^\/client-profiles(\/|$)/, () => "clients"],
  [/^\/packages\/[^/]+\/activity$/, () => "activity"],
  // Posts/Reels/Stories work records: creative team + sales + manager can edit (no money access needed)
  [/^\/packages\/[^/]+\/works(\/|$)/, getOrElse("clients", "calendar")],
  [/^\/(one-time-jobs|packages)(\/|$)/, getOrElse("clients", "payments")],
  [/^\/leads(\/|$)/, () => "leads"],
  [/^\/reports(\/|$)/, () => "reports"],
  [/^\/export\//, () => "reports"],
  [/^\/(backup|restore)$/, () => "backup"],
  [/^\/activity$/, () => "activity"],
  [/^\/users(\/|$)/, () => "team"],
  [/^\/(work|production|shoots|designs|social-media|social-management|monthly-cycles|festival-orders)(\/|$)/, getOrElse("work", "work")]
];

function resolveModule(req) {
  for (const [re, fn] of ROUTE_RULES) if (re.test(req.path)) return fn(req);
  return null;
}

/* ---------- Money hide (jene paisa na jova joie) ----------------------- */
const MONEY_KEYS = new Set([
  "totalBusiness", "totalReceived", "totalPending", "payments",
  "totalAmount", "paidAmount", "pendingAmount", "paymentHistory", "paymentStatus"
]);
function stripKeys(v) {
  if (Array.isArray(v)) return v.map(stripKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!MONEY_KEYS.has(k)) o[k] = stripKeys(x);
    return o;
  }
  return v;
}
function stripMoney(path, body) {
  if (path.startsWith("/calendar") && body && Array.isArray(body.events)) {
    body = { ...body, events: body.events.filter((e) => e.type !== "payment") };
  }
  return stripKeys(body);
}

/* ---------- Passwords & sessions -------------------------------------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || "").split("$");
  if (alg !== "scrypt" || !saltHex || !hashHex) return false;
  const key = await scryptAsync(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(hashHex, "hex");
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}
let _dummyHash = null;
async function dummyHash() {
  return _dummyHash || (_dummyHash = await hashPassword("dummy-password-for-timing"));
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("hex");
}
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}
function getCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
function setSession(req, res, user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const payload = `${user.id}.${user.session_version}.${exp}`;
  const token = payload + "." + sign(payload);
  const secure = req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`
  );
}
async function userFromRequest(req) {
  const token = getCookie(req, COOKIE_NAME);
  if (!token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 4) return null;
  const [id, sv, exp, sig] = parts;
  if (!safeEqual(sig, sign(`${id}.${sv}.${exp}`)) || Number(exp) <= Date.now()) return null;
  const uid = Number(id);
  if (!Number.isInteger(uid)) return null;
  const { rows } = await pool.query(
    "SELECT id, email, name, role, active, must_change_password, session_version FROM users WHERE id = $1",
    [uid]
  );
  const u = rows[0];
  if (!u || !u.active || u.session_version !== Number(sv)) return null;
  return u;
}

// Brute-force limit (15 minute window)
const attempts = new Map();
function isBlocked(key, max) {
  const r = attempts.get(key);
  if (!r) return false;
  if (Date.now() - r.first > 15 * 60000) { attempts.delete(key); return false; }
  return r.count >= max;
}
function noteFail(key) {
  const r = attempts.get(key);
  if (!r || Date.now() - r.first > 15 * 60000) attempts.set(key, { count: 1, first: Date.now() });
  else r.count++;
}

/* ---------- Activity log ---------------------------------------------- */
async function logActivity(dbc, user, action, entity, entityId, summary, details) {
  try {
    await dbc.query(
      "INSERT INTO activity_log (user_id, user_name, action, entity, entity_id, summary, details) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [user ? user.id : null, user ? user.name : null, action, entity || null, entityId || null, summary || null, details ? JSON.stringify(details) : null]
    );
  } catch (err) {
    console.error("Activity log failed:", err.message);
  }
}

/* ---------- Small HTML pages (login / setup / change password) -------- */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function authPage({ title, subtitle, fields, button, action, message, footer }) {
  const inputs = fields
    .map((f) => `<input type="${f.type || "text"}" name="${f.name}" placeholder="${esc(f.placeholder)}" autocomplete="${f.auto || "off"}" ${f.value ? `value="${esc(f.value)}"` : ""} ${f.autofocus ? "autofocus" : ""} required>`)
    .join("\n  ");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0f172a;font-family:system-ui,sans-serif}
  form{background:#fff;padding:32px;border-radius:14px;width:min(360px,90vw);box-shadow:0 10px 40px rgba(0,0,0,.35)}
  h1{margin:0 0 6px;font-size:22px;color:#0f172a} p{margin:0 0 18px;color:#64748b;font-size:14px}
  input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;margin-bottom:12px}
  button{width:100%;padding:12px;border:0;border-radius:8px;background:#0d9488;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  .err{color:#dc2626;font-size:14px;margin-bottom:12px}
  .foot{margin-top:14px;text-align:center;font-size:13px}.foot a{color:#0d9488}
</style></head><body>
<form method="POST" action="${action}">
  <h1>${esc(title)}</h1><p>${esc(subtitle)}</p>
  ${message ? `<div class="err">${esc(message)}</div>` : ""}
  ${inputs}
  <button type="submit">${esc(button)}</button>
  ${footer ? `<div class="foot">${footer}</div>` : ""}
</form></body></html>`;
}

const loginPage = (message) =>
  authPage({
    title: "Agency OS", subtitle: "Tamaro email ane password nakho", action: "/login", button: "Login", message,
    fields: [
      { name: "email", type: "email", placeholder: "Email", auto: "username", autofocus: true },
      { name: "password", type: "password", placeholder: "Password", auto: "current-password" }
    ]
  });

const setupPage = (message, v = {}) =>
  authPage({
    title: "Owner account banavo",
    subtitle: "Pehli vaar setup. Atyar no APP_PASSWORD nakho, pachi tamaro Owner account banavo.",
    action: "/setup", button: "Owner banavo", message,
    fields: [
      { name: "appPassword", type: "password", placeholder: "Atyar no APP_PASSWORD (Render ma che)", autofocus: true },
      { name: "name", placeholder: "Tamaru naam", auto: "name", value: v.name },
      { name: "email", type: "email", placeholder: "Email", auto: "username", value: v.email },
      { name: "password", type: "password", placeholder: `Navo password (min ${MIN_PASSWORD} akshar)`, auto: "new-password" },
      { name: "confirm", type: "password", placeholder: "Password pharithi", auto: "new-password" }
    ]
  });

const changePasswordPage = (message, forced) =>
  authPage({
    title: "Password badlo",
    subtitle: forced ? "Aagal vadhva pehla navo password set karo." : "Tamaro potano password badlo.",
    action: "/change-password", button: "Password badlo", message,
    footer: forced ? "" : '<a href="/">Pachu</a>',
    fields: [
      { name: "current", type: "password", placeholder: "Atyar no password", auto: "current-password", autofocus: true },
      { name: "password", type: "password", placeholder: `Navo password (min ${MIN_PASSWORD} akshar)`, auto: "new-password" },
      { name: "confirm", type: "password", placeholder: "Navo password pharithi", auto: "new-password" }
    ]
  });

const dbDownPage = () =>
  authPage({ title: "Agency OS", subtitle: "Database connect thai rahyo che. Thodi vaar pachi refresh karo.", fields: [], button: "Refresh", action: "/login", message: "" });

async function userCount() {
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM users");
  return rows[0].n;
}
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- Login / Setup / Logout / Change password ------------------ */
app.get("/login", async (req, res) => {
  try {
    if (!dbReady) return res.status(503).send(dbDownPage());
    if ((await userCount()) === 0) return res.redirect("/setup");
    res.send(loginPage(""));
  } catch (err) {
    res.status(500).send(loginPage("Server error. Pharithi try karo."));
  }
});

app.post("/login", async (req, res) => {
  try {
    if (!dbReady) return res.status(503).send(dbDownPage());
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const ipKey = "ip:" + req.ip;
    const emKey = "em:" + email;
    if (isBlocked(ipKey, 20) || isBlocked(emKey, 5)) {
      return res.status(429).send(loginPage("Ghana vadhare prayatno. 15 minute pachi try karo."));
    }
    const { rows } = await pool.query("SELECT * FROM users WHERE lower(email) = $1", [email]);
    const u = rows[0];
    const ok = await verifyPassword(password, u ? u.password_hash : await dummyHash());
    if (!u || !ok) {
      noteFail(ipKey); noteFail(emKey);
      return res.status(401).send(loginPage("Email ke password khotu che."));
    }
    if (!u.active) return res.status(403).send(loginPage("Aa account band che. Owner no sampark karo."));
    attempts.delete(emKey);
    await pool.query("UPDATE users SET last_login_at = now() WHERE id = $1", [u.id]);
    await logActivity(pool, u, "login", "user", String(u.id), `${u.name} logged in`);
    setSession(req, res, u);
    res.redirect(u.must_change_password ? "/change-password" : "/");
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).send(loginPage("Server error. Pharithi try karo."));
  }
});

app.get("/setup", async (req, res) => {
  try {
    if (!dbReady) return res.status(503).send(dbDownPage());
    if ((await userCount()) > 0) return res.redirect("/login");
    res.send(setupPage(APP_PASSWORD ? "" : "APP_PASSWORD Render ma set nathi — setup mate e jaruri che."));
  } catch (err) {
    res.status(500).send(setupPage("Server error."));
  }
});

app.post("/setup", async (req, res) => {
  const body = req.body || {};
  const keep = { name: body.name, email: body.email };
  if (!dbReady) return res.status(503).send(dbDownPage());
  let c;
  try {
    c = await pool.connect();
    const ipKey = "setup:" + req.ip;
    if (isBlocked(ipKey, 5)) return res.status(429).send(setupPage("Ghana vadhare prayatno. 15 minute pachi try karo.", keep));
    if (!APP_PASSWORD) return res.status(503).send(setupPage("APP_PASSWORD Render ma set nathi.", keep));
    if (!safeEqual(body.appPassword || "", APP_PASSWORD)) {
      noteFail(ipKey);
      return res.status(401).send(setupPage("APP_PASSWORD khotu che.", keep));
    }
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!name) return res.status(400).send(setupPage("Naam jaruri che.", keep));
    if (!validEmail(email)) return res.status(400).send(setupPage("Sacho email nakho.", keep));
    if (password.length < MIN_PASSWORD) return res.status(400).send(setupPage(`Password kam ma kam ${MIN_PASSWORD} akshar no hovo joie.`, keep));
    if (password !== body.confirm) return res.status(400).send(setupPage("Banne password match nathi thata.", keep));

    const hash = await hashPassword(password);
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(727001)");
    const n = (await c.query("SELECT count(*)::int AS n FROM users")).rows[0].n;
    if (n > 0) {
      await c.query("ROLLBACK");
      return res.redirect("/login");
    }
    const { rows } = await c.query(
      "INSERT INTO users (email, name, role, password_hash) VALUES ($1,$2,'owner',$3) RETURNING id, email, name, role, session_version",
      [email, name, hash]
    );
    await logActivity(c, rows[0], "setup", "user", String(rows[0].id), `${name} created the Owner account`);
    await c.query("COMMIT");
    setSession(req, res, rows[0]);
    res.redirect("/");
  } catch (err) {
    try { if (c) await c.query("ROLLBACK"); } catch (_) {}
    console.error("Setup error:", err);
    res.status(500).send(setupPage("Server error: " + err.message, keep));
  } finally {
    if (c) c.release();
  }
});

app.get("/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.redirect("/login");
});

// Everything below needs a logged-in, active user.
app.use(async (req, res, next) => {
  if (req.path === "/healthz") return next();
  const isApi = req.path.startsWith("/api");
  try {
    if (!dbReady) {
      return isApi ? res.status(503).json({ error: "Database is not connected yet. Try again shortly." }) : res.status(503).send(dbDownPage());
    }
    const user = await userFromRequest(req);
    if (!user) {
      if (isApi) return res.status(401).json({ error: "Login required" });
      return res.redirect((await userCount()) === 0 ? "/setup" : "/login");
    }
    req.user = user;
    if (user.must_change_password && req.path !== "/change-password") {
      if (isApi) return res.status(403).json({ error: "Pehla navo password set karo.", code: "MUST_CHANGE_PASSWORD" });
      return res.redirect("/change-password");
    }
    next();
  } catch (err) {
    console.error("Auth error:", err);
    isApi ? res.status(500).json({ error: "Auth error" }) : res.status(500).send("Server error");
  }
});

app.get("/change-password", (req, res) => {
  res.send(changePasswordPage("", req.user.must_change_password));
});

app.post("/change-password", async (req, res) => {
  const forced = req.user.must_change_password;
  try {
    const { current = "", password = "", confirm = "" } = req.body || {};
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
    if (!rows[0] || !(await verifyPassword(String(current), rows[0].password_hash))) {
      return res.status(401).send(changePasswordPage("Atyar nu password khotu che.", forced));
    }
    if (password.length < MIN_PASSWORD) return res.status(400).send(changePasswordPage(`Navo password kam ma kam ${MIN_PASSWORD} akshar no hovo joie.`, forced));
    if (password !== confirm) return res.status(400).send(changePasswordPage("Banne password match nathi thata.", forced));
    if (password === current) return res.status(400).send(changePasswordPage("Navo password juna thi alag hovo joie.", forced));
    const hash = await hashPassword(password);
    const upd = await pool.query(
      "UPDATE users SET password_hash = $1, must_change_password = FALSE, session_version = session_version + 1 WHERE id = $2 RETURNING id, session_version",
      [hash, req.user.id]
    );
    await logActivity(pool, req.user, "password_changed", "user", String(req.user.id), `${req.user.name} changed their password`);
    setSession(req, res, upd.rows[0]); // aa device logged-in rahe, bija badha device logout
    res.redirect("/");
  } catch (err) {
    console.error("Change password error:", err);
    res.status(500).send(changePasswordPage("Server error.", forced));
  }
});

// Simple activity page (Owner + Manager)
app.get("/activity", async (req, res) => {
  if (!accessLevel(req.user.role, "activity")) return res.status(403).send("Aa page mate permission nathi.");
  const { rows } = await pool.query("SELECT * FROM activity_log ORDER BY id DESC LIMIT 300");
  const tr = rows
    .map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }))}</td><td>${esc(r.user_name || "-")}</td><td>${esc(r.action)}</td><td>${esc(r.summary || "")}</td></tr>`)
    .join("");
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Activity</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:20px;background:#f8fafc;color:#0f172a}h1{font-size:20px}a{color:#0d9488}
table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}th,td{padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#f1f5f9}
.w{overflow-x:auto}</style></head><body><h1>Activity log <small><a href="/">← App</a></small></h1><div class="w"><table>
<tr><th>Kyare (IST)</th><th>Kon</th><th>Shu</th><th>Vigat</th></tr>${tr || '<tr><td colspan="4">Haju kai nathi.</td></tr>'}</table></div></body></html>`);
});

// Only serve the real front-end files (NOT server.js, data.json, .env, etc.)
["style.css", "script.js", "index.html"].forEach((f) => {
  app.get("/" + f, (req, res) => res.sendFile(path.join(__dirname, f)));
});


/* ---------------------------------------------------------------------- */
/* Database (Supabase Postgres) — replaces the old data.json file so data */
/* survives restarts / free-tier spin-downs.                              */
/* ---------------------------------------------------------------------- */

const LOCAL_DB = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || "");
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: LOCAL_DB ? false : { rejectUnauthorized: false }
});

const ROW_ID = "main";

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);
  const { rows } = await pool.query("SELECT 1 FROM app_data WHERE id = $1", [ROW_ID]);
  if (rows.length === 0) {
    await pool.query("INSERT INTO app_data (id, data) VALUES ($1, $2)", [ROW_ID, DEFAULT_DATA]);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
      session_version INT NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `);
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email))");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS activity_log (
      id BIGSERIAL PRIMARY KEY,
      at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_id INT,
      user_name TEXT,
      action TEXT NOT NULL,
      entity TEXT,
      entity_id TEXT,
      summary TEXT,
      details JSONB
    )
  `);
  await pool.query("CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)");
  await applyOwnerReset();
}

// Emergency: Owner password bhulay to Render ma OWNER_RESET_PASSWORD set karo
// (optional OWNER_RESET_EMAIL). Server restart par ek vaar j apply thase, ane
// Owner e pehli login par navo password set karvo padse. Pachi variable kadhi nakho.
async function applyOwnerReset() {
  const pw = process.env.OWNER_RESET_PASSWORD || "";
  if (!pw) return;
  if (pw.length < MIN_PASSWORD) {
    console.error(`OWNER_RESET_PASSWORD kam ma kam ${MIN_PASSWORD} akshar nu hovu joie.`);
    return;
  }
  const fp = crypto.createHash("sha256").update("owner-reset:" + pw).digest("hex");
  const m = await pool.query("SELECT value FROM app_meta WHERE key = 'owner_reset_fp'");
  if (m.rows[0] && m.rows[0].value === fp) return;
  const email = (process.env.OWNER_RESET_EMAIL || "").trim().toLowerCase();
  const q = email
    ? await pool.query("SELECT id, name FROM users WHERE role = 'owner' AND lower(email) = $1", [email])
    : await pool.query("SELECT id, name FROM users WHERE role = 'owner' ORDER BY id LIMIT 1");
  if (!q.rows[0]) {
    console.error("OWNER_RESET_PASSWORD set che pan Owner user nathi (haju setup nathi thayu?).");
    return;
  }
  const hash = await hashPassword(pw);
  await pool.query(
    "UPDATE users SET password_hash = $1, must_change_password = TRUE, active = TRUE, session_version = session_version + 1 WHERE id = $2",
    [hash, q.rows[0].id]
  );
  await pool.query(
    "INSERT INTO app_meta (key, value) VALUES ('owner_reset_fp', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [fp]
  );
  await logActivity(pool, null, "owner_reset", "user", String(q.rows[0].id), `Owner password was reset via OWNER_RESET_PASSWORD (${q.rows[0].name})`);
  console.warn("Owner password reset applied. OWNER_RESET_PASSWORD Render mathi kadhi nakho.");
}

/* ---------------------------------------------------------------------- */
/* Data helpers                                                           */
/* ---------------------------------------------------------------------- */

const DEFAULT_DATA = {
  payments: [],
  categories: ["Post", "Reel", "Video", "Design", "Ads", "Management", "Other"],
  expenses: [],
  expenseCategories: ["Ad Spend", "Software/Tools", "Salary", "Freelancer", "Rent", "Internet/Phone", "Travel", "Nasto", "Other"],
  leads: [],
  leadSources: ["Instagram DM", "Referral", "Cold Call", "Website", "Other"],
  settings: {
    companyName: "My Agency",
    currency: "₹",
    themeColor: "teal",
    darkMode: false
  },
  // ---- One-Time Jobs / Packages tracking ----
  oneTimeJobs: [],
  packages: [],
  clientProfiles: {},        // keyed by mobile (or clientName fallback) -> { location, folderPath }
  calendarEvents: [],        // manual calendar events
  clientIds: {},             // keyed by mobile (or clientName fallback) -> permanent ID, e.g. "CLI-000124"
  platformOptions: ["Instagram", "Facebook", "YouTube", "LinkedIn", "Twitter/X", "Pinterest", "Other"],
  contentProduction: [], shoots: [], designs: [], socialMediaPosts: [], monthlyCycles: [], festivalOrders: []
};

const dbq = () => (dbContext.getStore() || {}).client || pool;

async function loadData() {
  const { rows } = await dbq().query("SELECT data FROM app_data WHERE id = $1", [ROW_ID]);
  const raw = rows[0] ? rows[0].data : {};

  // Normalize shape / fill in defaults defensively
  const data = {
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    categories: Array.isArray(raw.categories) ? raw.categories : [...DEFAULT_DATA.categories],
    expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
    expenseCategories: Array.isArray(raw.expenseCategories) ? raw.expenseCategories : [...DEFAULT_DATA.expenseCategories],
    leads: Array.isArray(raw.leads) ? raw.leads : [],
    leadSources: Array.isArray(raw.leadSources) ? raw.leadSources : [...DEFAULT_DATA.leadSources],
    settings: {
      ...DEFAULT_DATA.settings,
      ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {})
    },
    oneTimeJobs: Array.isArray(raw.oneTimeJobs) ? raw.oneTimeJobs : [],
    packages: Array.isArray(raw.packages) ? raw.packages : [],
    clientProfiles: raw.clientProfiles && typeof raw.clientProfiles === "object" ? raw.clientProfiles : {},
    clientIds: raw.clientIds && typeof raw.clientIds === "object" ? raw.clientIds : {},
    calendarEvents: Array.isArray(raw.calendarEvents) ? raw.calendarEvents : [],
    platformOptions: Array.isArray(raw.platformOptions) ? raw.platformOptions : [...DEFAULT_DATA.platformOptions],
    contentProduction: Array.isArray(raw.contentProduction) ? raw.contentProduction : [],
    shoots: Array.isArray(raw.shoots) ? raw.shoots : [],
    designs: Array.isArray(raw.designs) ? raw.designs : [],
    socialMediaPosts: Array.isArray(raw.socialMediaPosts) ? raw.socialMediaPosts : [],
    monthlyCycles: Array.isArray(raw.monthlyCycles) ? raw.monthlyCycles : [],
    festivalOrders: Array.isArray(raw.festivalOrders) ? raw.festivalOrders : []
  };

  // One-time migration: make sure the "Nasto" expense category exists on
  // data that was created before it was added to the defaults.
  if (!data.expenseCategories.some((c) => c.toLowerCase() === "nasto")) {
    data.expenseCategories.push("Nasto");
    if (dbContext.getStore()) await saveData(data);
  }

  // Permanent Client IDs: give every client that has none yet an ID.
  // Existing IDs are never changed or reused.
  if (reconcileClients(data) && dbContext.getStore()) {
    await saveData(data);
  }

  return data;
}

async function saveData(data) {
  reconcileClients(data);
  await dbq().query("UPDATE app_data SET data = $1 WHERE id = $2", [data, ROW_ID]);
}

function nextPaymentId(payments) {
  let maxNum = 1000;
  payments.forEach((p) => {
    const match = /^PMT-(\d+)$/.exec(p.id || "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return `PMT-${maxNum + 1}`;
}

function computeStatus(totalAmount, paidAmount) {
  const total = Number(totalAmount) || 0;
  const paid = Number(paidAmount) || 0;
  if (paid <= 0) return "Pending";
  if (paid >= total && total > 0) return "Paid";
  return "Partial";
}

function normalizePayment(input, existing = {}) {
  const totalAmount = Number(input.totalAmount) || 0;
  const paidAmount = Number(input.paidAmount) || 0;
  const pendingAmount = Math.max(totalAmount - paidAmount, 0);
  const status = input.status || computeStatus(totalAmount, paidAmount);

  return {
    id: existing.id,
    clientId: (existing.clientId || input.clientId || "").toString().trim(),
    clientName: (input.clientName ?? existing.clientName ?? "").toString().trim(),
    mobile: (input.mobile ?? existing.mobile ?? "").toString().trim(),
    businessName: (input.businessName ?? existing.businessName ?? "").toString().trim(),
    instagram: (input.instagram ?? existing.instagram ?? "").toString().trim(),
    workDetails: (input.workDetails ?? existing.workDetails ?? "").toString().trim(),
    category: input.category ?? existing.category ?? "Other",
    date: input.date ?? existing.date ?? new Date().toISOString().slice(0, 10),
    totalAmount,
    paidAmount,
    pendingAmount,
    status,
    dueDate: input.dueDate ?? existing.dueDate ?? "",
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function nextExpenseId(expenses) {
  let maxNum = 1000;
  expenses.forEach((e) => {
    const match = /^EXP-(\d+)$/.exec(e.id || "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return `EXP-${maxNum + 1}`;
}

function normalizeExpense(input, existing = {}) {
  return {
    id: existing.id,
    date: input.date ?? existing.date ?? new Date().toISOString().slice(0, 10),
    category: (input.category ?? existing.category ?? "Other").toString().trim() || "Other",
    amount: Number(input.amount ?? existing.amount ?? 0) || 0,
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

const LEAD_STATUSES = ["New", "Contacted", "Follow-up", "Interested", "Converted", "Lost"];

function nextLeadId(leads) {
  let maxNum = 1000;
  leads.forEach((l) => {
    const match = /^LED-(\d+)$/.exec(l.id || "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return `LED-${maxNum + 1}`;
}

function normalizeLead(input, existing = {}) {
  const status = LEAD_STATUSES.includes(input.status)
    ? input.status
    : (existing.status || "New");

  return {
    id: existing.id,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    mobile: (input.mobile ?? existing.mobile ?? "").toString().trim(),
    businessName: (input.businessName ?? existing.businessName ?? "").toString().trim(),
    instagram: (input.instagram ?? existing.instagram ?? "").toString().trim(),
    source: (input.source ?? existing.source ?? "Other").toString().trim() || "Other",
    status,
    expectedValue: Number(input.expectedValue ?? existing.expectedValue ?? 0) || 0,
    nextFollowupDate: input.nextFollowupDate ?? existing.nextFollowupDate ?? "",
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    convertedPaymentId: existing.convertedPaymentId ?? null,
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

/* ---------------------------------------------------------------------- */
/* One-Time Jobs / Packages                                               */
/* Both belong directly to a Client (clientMobile / clientName).          */
/* Package has a `type`: "PostReel" (fixed deliverable counts) or         */
/* "Management" (ongoing, platform-wise upload counters).                 */
/* ---------------------------------------------------------------------- */

const JOB_STATUSES = ["Active", "In Progress", "On Hold", "Completed"];
const JOB_PRIORITIES = ["Low", "Medium", "High"];
const PACKAGE_STATUSES = ["Upcoming", "Active", "On Hold", "Completed", "Expired", "Cancelled"];
const BILLING_CYCLES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly", "One-time"];
const DELIVERABLE_CYCLES = ["Month", "Week", "Quarter", "Year", "Total"];
const WORK_KINDS = ["post", "reel", "story"];
const WORK_STATUSES = ["Pending", "In Progress", "Completed"];
const PACKAGE_TYPES = ["PostReel", "Management"];

function nextId(list, prefix) {
  let maxNum = 1000;
  list.forEach((item) => {
    const match = new RegExp(`^${prefix}-(\\d+)$`).exec(item.id || "");
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxNum) maxNum = n;
    }
  });
  return `${prefix}-${maxNum + 1}`;
}

/* ---- Permanent Client IDs (CLI-000001 …) ----------------------------- */
/* Every payment / package / one-time job carries a `clientId`. The ID    */
/* is generated once by the server and never changes, even if the         */
/* client's mobile number or name is edited later.                        */
/* data.clientIds is an alias table: mobile (or name) -> clientId. Old    */
/* and new mobile numbers can both point to the same ID.                  */
// CLIENT_ID_START
function formatClientId(n) {
  return "CLI-" + String(n).padStart(6, "0");
}

function recordClientKey(rec) {
  return (rec.mobile || rec.clientMobile || rec.clientName || "").toString().trim();
}

function reconcileClients(data) {
  if (!data.clientIds || typeof data.clientIds !== "object") data.clientIds = {};
  if (!data.clientProfiles || typeof data.clientProfiles !== "object") data.clientProfiles = {};
  const ids = data.clientIds;
  let changed = false;

  const records = [
    ...(data.payments || []),
    ...(data.packages || []),
    ...(data.oneTimeJobs || [])
  ];

  let max = 0;
  const bump = (id) => {
    const m = /^CLI-(\d+)$/.exec(id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  };
  Object.values(ids).forEach(bump);
  records.forEach((r) => bump(r.clientId));

  // Pass 1: records that already have an ID make sure their current
  // mobile/name points at that ID (this is how a changed mobile is learned).
  records.forEach((r) => {
    const key = recordClientKey(r);
    if (r.clientId && key && !ids[key]) {
      ids[key] = r.clientId;
      changed = true;
    }
  });

  // Pass 2: records without an ID get one (existing client by key, or new).
  records.forEach((r) => {
    if (r.clientId) return;
    const key = recordClientKey(r);
    if (!key) return;
    if (!ids[key]) {
      max += 1;
      ids[key] = formatClientId(max);
    }
    r.clientId = ids[key];
    changed = true;
  });

  // Client profiles are stored under the permanent ID (not mobile/name).
  Object.keys(data.clientProfiles).forEach((k) => {
    if (/^CLI-\d+$/.test(k)) return;
    const id = ids[k];
    if (!id) return;
    if (!data.clientProfiles[id]) data.clientProfiles[id] = data.clientProfiles[k];
    delete data.clientProfiles[k];
    changed = true;
  });

  return changed;
}

// When a record is edited and its mobile/name now matches a DIFFERENT
// existing client, move the record to that client. If the new mobile/name
// is unknown, the record simply keeps its client (contact detail changed).
function retargetClientId(data, oldRec, newRec) {
  const oldKey = recordClientKey(oldRec);
  const newKey = recordClientKey(newRec);
  if (oldKey === newKey) return;
  const mapped = (data.clientIds || {})[newKey];
  if (mapped && mapped !== newRec.clientId) newRec.clientId = mapped;
}
// CLIENT_ID_END

function clientProfileKey(mobile, clientName) {
  return (mobile || clientName || "").toString().trim();
}

function normalizePaymentHistoryEntry(input, existing = {}) {
  return {
    id: existing.id || `PH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    date: input.date ?? existing.date ?? new Date().toISOString().slice(0, 10),
    amount: Number(input.amount ?? existing.amount ?? 0) || 0,
    type: (input.type ?? existing.type ?? "Advance").toString().trim() || "Advance",
    note: (input.note ?? existing.note ?? "").toString().trim(),
    method: (input.method ?? existing.method ?? "").toString().trim(),
    reference: (input.reference ?? existing.reference ?? "").toString().trim(),
    addedBy: (input.addedBy ?? existing.addedBy ?? "").toString().trim()
  };
}

function derivePayment(totalAmount, paymentHistory) {
  const paidAmount = paymentHistory.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
  const pendingAmount = Math.max(totalAmount - paidAmount, 0);
  return { paidAmount, pendingAmount, paymentStatus: computeStatus(totalAmount, paidAmount) };
}

// ONE-TIME JOB — a single, non-recurring task for a client.
function normalizeOneTimeJob(input, existing = {}) {
  const status = JOB_STATUSES.includes(input.status) ? input.status : (existing.status || "Active");
  const priority = JOB_PRIORITIES.includes(input.priority) ? input.priority : (existing.priority || "Medium");

  const paymentHistory = Array.isArray(input.paymentHistory)
    ? input.paymentHistory.map((h) => normalizePaymentHistoryEntry(h))
    : (Array.isArray(existing.paymentHistory) ? existing.paymentHistory : []);
  const totalAmount = Number(input.totalAmount ?? existing.totalAmount ?? 0) || 0;
  const { paidAmount, pendingAmount, paymentStatus } = derivePayment(totalAmount, paymentHistory);

  return {
    id: existing.id,
    clientId: (existing.clientId || input.clientId || "").toString().trim(),
    clientName: (input.clientName ?? existing.clientName ?? "").toString().trim(),
    clientMobile: (input.clientMobile ?? existing.clientMobile ?? "").toString().trim(),
    name: (input.name ?? existing.name ?? "").toString().trim(),
    category: (input.category ?? existing.category ?? "").toString().trim(),
    startDate: input.startDate ?? existing.startDate ?? new Date().toISOString().slice(0, 10),
    dueDate: input.dueDate ?? existing.dueDate ?? "",
    status,
    priority,
    // Optional multi-unit progress (e.g. "10 Banners")
    totalUnits: Number(input.totalUnits ?? existing.totalUnits ?? 0) || 0,
    doneUnits: Number(input.doneUnits ?? existing.doneUnits ?? 0) || 0,
    // Payment
    totalAmount,
    paymentHistory,
    paidAmount,
    pendingAmount,
    paymentStatus,
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function normalizeCounterPair(input) {
  return {
    total: Number(input?.total) || 0,
    done: Number(input?.done) || 0
  };
}

// A single piece of delivered work (post / reel / story) inside a Post & Reel package.
function normalizeWork(input, existing = {}) {
  const str = (v) => (v ?? "").toString().trim();
  const kind = WORK_KINDS.includes(input.kind) ? input.kind : (existing.kind || "post");
  const status = WORK_STATUSES.includes(input.status) ? input.status : (existing.status || "Pending");
  let completedDate = str(input.completedDate ?? existing.completedDate);
  if (status === "Completed") {
    if (!completedDate) completedDate = new Date().toISOString().slice(0, 10);
  } else {
    completedDate = "";
  }
  return {
    id: existing.id || input.id || "",
    kind,
    name: str(input.name ?? existing.name),
    assignedTo: str(input.assignedTo ?? existing.assignedTo),
    status,
    plannedDate: str(input.plannedDate ?? existing.plannedDate),
    shootDate: str(input.shootDate ?? existing.shootDate),
    dueDate: str(input.dueDate ?? existing.dueDate),
    completedDate,
    createdAt: existing.createdAt || input.createdAt || new Date().toISOString()
  };
}

function normalizePlatformRow(input) {
  return {
    name: (input.name || "").toString().trim() || "Other",
    active: input.active !== false,
    posts: Number(input.posts) || 0,
    reels: Number(input.reels) || 0,
    stories: Number(input.stories) || 0
  };
}

// PACKAGE — flat, belongs directly to a Client. type = "PostReel" tracks
// fixed Posts/Reels/Stories counts; type = "Management" tracks per-platform
// upload counters against the fixed platform master list.
function normalizePackage(input, existing = {}) {
  const status = PACKAGE_STATUSES.includes(input.status) ? input.status : (existing.status || "Active");
  const type = PACKAGE_TYPES.includes(input.type) ? input.type : (existing.type || "PostReel");

  const paymentHistory = Array.isArray(input.paymentHistory)
    ? input.paymentHistory.map((h) => normalizePaymentHistoryEntry(h))
    : (Array.isArray(existing.paymentHistory) ? existing.paymentHistory : []);
  const totalAmount = Number(input.totalAmount ?? existing.totalAmount ?? 0) || 0;
  const { paidAmount, pendingAmount, paymentStatus } = derivePayment(totalAmount, paymentHistory);

  const base = {
    id: existing.id,
    clientId: (existing.clientId || input.clientId || "").toString().trim(),
    clientName: (input.clientName ?? existing.clientName ?? "").toString().trim(),
    clientMobile: (input.clientMobile ?? existing.clientMobile ?? "").toString().trim(),
    name: (input.name ?? existing.name ?? "").toString().trim(),
    type,
    startDate: input.startDate ?? existing.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: input.endDate ?? existing.endDate ?? "",
    status,
    totalAmount,
    paymentHistory,
    paidAmount,
    pendingAmount,
    paymentStatus,
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    billingCycle: BILLING_CYCLES.includes(input.billingCycle) ? input.billingCycle : (existing.billingCycle || "Monthly"),
    accountManager: (input.accountManager ?? existing.accountManager ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };

  if (type === "Management") {
    const platforms = Array.isArray(input.platforms)
      ? input.platforms.map(normalizePlatformRow)
      : (Array.isArray(existing.platforms) ? existing.platforms : []);
    return { ...base, platforms };
  }

  // PostReel type. "done" is derived from the real work records
  // (completed works + any older manually-entered count kept as legacyDone).
  const works = Array.isArray(input.works)
    ? input.works.map((w) => normalizeWork(w))
    : (Array.isArray(existing.works) ? existing.works : []);
  const prevWorks = Array.isArray(existing.works) ? existing.works : [];
  const completedOf = (list, kind) => list.filter((w) => w.kind === kind && w.status === "Completed").length;

  const deliverable = (key, kind) => {
    const inp = input[key] || {};
    const ex = existing[key] || {};
    const completed = completedOf(works, kind);
    let legacy = Number(ex.legacyDone);
    if (!Number.isFinite(legacy)) legacy = Math.max((Number(ex.done) || 0) - completedOf(prevWorks, kind), 0);
    // The old edit form sends a typed "done" number: keep the difference as legacy.
    if (inp.done !== undefined && Number(inp.done) !== (Number(ex.done) || 0)) {
      legacy = Math.max((Number(inp.done) || 0) - completed, 0);
    }
    const cycleIn = inp.cycle ?? ex.cycle;
    return {
      total: Number(inp.total ?? ex.total) || 0,
      done: completed + legacy,
      legacyDone: legacy,
      cycle: DELIVERABLE_CYCLES.includes(cycleIn) ? cycleIn : "Month"
    };
  };

  return {
    ...base,
    posts: deliverable("posts", "post"),
    reels: deliverable("reels", "reel"),
    stories: deliverable("stories", "story"),
    works
  };
}

// Derived, never stored.
function computePackageProgress(pkg) {
  if (pkg.type === "Management") {
    const totals = (pkg.platforms || []).reduce((acc, p) => {
      acc.posts += Number(p.posts) || 0;
      acc.reels += Number(p.reels) || 0;
      acc.stories += Number(p.stories) || 0;
      return acc;
    }, { posts: 0, reels: 0, stories: 0 });
    return { type: "Management", ...totals, totalUploaded: totals.posts + totals.reels + totals.stories };
  }
  const kind = (c) => {
    const total = Number(c && c.total) || 0;
    const done = Math.min(Number(c && c.done) || 0, total);
    return { total, done, pending: total - done, percent: total > 0 ? Math.floor((done / total) * 100) : 0 };
  };
  const posts = kind(pkg.posts);
  const reels = kind(pkg.reels);
  const stories = kind(pkg.stories);
  const total = posts.total + reels.total + stories.total;
  const done = posts.done + reels.done + stories.done;
  const percent = total > 0 ? Math.floor((done / total) * 100) : 0;
  return { type: "PostReel", total, done, pending: total - done, percent, posts, reels, stories };
}

function enrichPackage(pkg) {
  return { ...pkg, progress: computePackageProgress(pkg) };
}


/* ---------------------------------------------------------------------- */
/* Derived data builders                                                  */
/* ---------------------------------------------------------------------- */

function buildClients(payments, clientIds = {}) {
  const map = new Map();
  payments.forEach((p) => {
    const key = p.clientId || p.mobile || p.clientName;
    if (!map.has(key)) {
      map.set(key, {
        clientId: p.clientId || clientIds[(p.mobile || p.clientName || "").toString().trim()] || "",
        clientName: p.clientName,
        mobile: p.mobile,
        businessName: p.businessName,
        instagram: p.instagram,
        totalBusiness: 0,
        totalReceived: 0,
        totalPending: 0,
        paymentsCount: 0,
        payments: []
      });
    }
    const c = map.get(key);
    c.totalBusiness += Number(p.totalAmount) || 0;
    c.totalReceived += Number(p.paidAmount) || 0;
    c.totalPending += Number(p.pendingAmount) || 0;
    c.paymentsCount += 1;
    c.payments.push(p);
    // Keep most recent contact info (a client's mobile/name may change)
    if (p.clientName) c.clientName = p.clientName;
    if (p.mobile) c.mobile = p.mobile;
    if (p.businessName) c.businessName = p.businessName;
    if (p.instagram) c.instagram = p.instagram;
  });
  return Array.from(map.values()).sort((a, b) => b.totalBusiness - a.totalBusiness);
}

function buildDashboard(payments, monthKey) {
  // Dropdown should always list the full current year (Jan–Dec) so every
  // month is selectable even before it has any payments, plus any other
  // months that actually have data (e.g. from a previous year).
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthKey = `${currentYear}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const yearMonths = Array.from({ length: 12 }, (_, i) => `${currentYear}-${String(i + 1).padStart(2, "0")}`);
  const dataMonths = Array.from(new Set(payments.map((p) => (p.date || "").slice(0, 7)).filter(Boolean)));
  const availableMonths = Array.from(new Set([...yearMonths, ...dataMonths])).sort((a, b) => b.localeCompare(a));

  let selectedMonth;
  if (monthKey === "all") selectedMonth = "all";
  else if (monthKey) selectedMonth = monthKey;
  else selectedMonth = currentMonthKey;

  const scoped = selectedMonth === "all"
    ? payments
    : payments.filter((p) => (p.date || "").slice(0, 7) === selectedMonth);

  const totalBusiness = scoped.reduce((sum, p) => sum + (Number(p.totalAmount) || 0), 0);
  const received = scoped.reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);
  const pending = scoped.reduce((sum, p) => sum + (Number(p.pendingAmount) || 0), 0);

  const clientKeys = new Set(scoped.map((p) => p.clientId || p.mobile || p.clientName));
  const totalClients = clientKeys.size;

  const monthlyBusiness = payments
    .filter((p) => (p.date || "").slice(0, 7) === currentMonthKey)
    .reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);

  const todayStr = now.toISOString().slice(0, 10);
  const todaysCollection = scoped
    .filter((p) => p.date === todayStr)
    .reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);
  const todaysPending = scoped
    .filter((p) => p.date === todayStr)
    .reduce((sum, p) => sum + (Number(p.pendingAmount) || 0), 0);

  const paymentProgress = totalBusiness > 0 ? Math.round((received / totalBusiness) * 100) : 0;

  const recentPayments = [...scoped]
    .sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date))
    .slice(0, 6);

  const upcomingDue = scoped
    .filter((p) => p.pendingAmount > 0 && p.dueDate)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    .slice(0, 6);

  const statusCounts = { Paid: 0, Partial: 0, Pending: 0 };
  scoped.forEach((p) => {
    if (statusCounts[p.status] !== undefined) statusCounts[p.status] += 1;
  });

  // Monthly income trend always spans every month so the line chart keeps
  // its full history regardless of which month is selected. "Income" here
  // means cash actually received (paidAmount), not the total billed amount
  // — otherwise unpaid/pending invoices would inflate income and profit.
  const monthlyIncome = {};
  payments.forEach((p) => {
    const key = (p.date || "").slice(0, 7);
    if (!key) return;
    monthlyIncome[key] = (monthlyIncome[key] || 0) + (Number(p.paidAmount) || 0);
  });

  const categoryTotals = {};
  scoped.forEach((p) => {
    categoryTotals[p.category] = (categoryTotals[p.category] || 0) + (Number(p.totalAmount) || 0);
  });

  return {
    selectedMonth,
    availableMonths,
    totalBusiness,
    received,
    pending,
    totalClients,
    monthlyBusiness,
    todaysCollection,
    todaysPending,
    paymentProgress,
    recentPayments,
    upcomingDue,
    statusCounts,
    monthlyIncome,
    categoryTotals
  };
}

/* ---------------------------------------------------------------------- */
/* Overview — 100% computed analytics layer.                             */
/* Never stores its own numbers: everything below is derived live from   */
/* One-Time Jobs (payments), Packages (+ their payment history) and      */
/* Leads, so it automatically reflects any change to those records.      */
/* ---------------------------------------------------------------------- */

function clientKeyOfPayment(p) {
  return (p.clientId || p.mobile || p.clientName || "").toString().trim();
}
function clientKeyOfPackage(pkg) {
  return (pkg.clientId || pkg.clientMobile || pkg.clientName || "").toString().trim();
}

// Whole-month difference between two YYYY-MM-DD strings, rounded up to at
// least 1 — used to bucket packages by sold duration (1 Month, 2 Months…)
// and to spread a package's total value into a monthly-equivalent (MRR).
function monthSpan(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return null;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  const dayAdjust = end.getDate() >= start.getDate() ? 0 : -1;
  months += dayAdjust;
  return Math.max(months, 1);
}

function buildOverview(data, monthKey) {
  const payments = data.payments || [];
  const packages = data.packages || [];
  const leads = data.leads || [];

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const todayStr = now.toISOString().slice(0, 10);

  const dataMonths = Array.from(new Set([
    ...payments.map((p) => (p.date || "").slice(0, 7)),
    ...packages.map((p) => (p.startDate || "").slice(0, 7)),
    ...packages.flatMap((p) => (p.paymentHistory || []).map((h) => (h.date || "").slice(0, 7)))
  ].filter(Boolean)));
  const yearMonths = Array.from({ length: 12 }, (_, i) => `${now.getFullYear()}-${String(i + 1).padStart(2, "0")}`);
  const availableMonths = Array.from(new Set([...yearMonths, ...dataMonths])).sort((a, b) => b.localeCompare(a));

  let selectedMonth;
  if (monthKey === "all") selectedMonth = "all";
  else if (monthKey) selectedMonth = monthKey;
  else selectedMonth = currentMonthKey;

  const inScope = (dateStr) => selectedMonth === "all" || (dateStr || "").slice(0, 7) === selectedMonth;

  /* ---------------- Clients (union across One-Time Jobs + Packages) --- */
  const oneTimeClientKeys = new Set(payments.map(clientKeyOfPayment).filter(Boolean));
  const packageClientKeys = new Set(packages.map(clientKeyOfPackage).filter(Boolean));
  const allClientKeys = new Set([...oneTimeClientKeys, ...packageClientKeys]);
  const oneTimeOnlyKeys = new Set([...oneTimeClientKeys].filter((k) => !packageClientKeys.has(k)));

  const firstSeen = new Map();
  payments.forEach((p) => {
    const key = clientKeyOfPayment(p);
    if (!key) return;
    const d = p.date || (p.createdAt || "").slice(0, 10);
    if (!firstSeen.has(key) || d < firstSeen.get(key)) firstSeen.set(key, d);
  });
  packages.forEach((p) => {
    const key = clientKeyOfPackage(p);
    if (!key) return;
    const d = p.startDate || (p.createdAt || "").slice(0, 10);
    if (!firstSeen.has(key) || d < firstSeen.get(key)) firstSeen.set(key, d);
  });
  const newClientsThisMonth = Array.from(firstSeen.values()).filter((d) => (d || "").slice(0, 7) === currentMonthKey).length;

  /* ---------------- Income split (One-Time vs Package), scoped -------- */
  const scopedPayments = payments.filter((p) => inScope(p.date));
  const oneTimeIncome = scopedPayments.reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0);

  const packageIncome = packages.reduce((sum, pkg) => {
    return sum + (pkg.paymentHistory || [])
      .filter((h) => inScope(h.date))
      .reduce((s, h) => s + (Number(h.amount) || 0), 0);
  }, 0);

  // MRR — active packages' total value spread evenly across their sold
  // duration, summed. Packages without a usable end date are ignored.
  const mrr = packages
    .filter((pkg) => pkg.status === "Active")
    .reduce((sum, pkg) => {
      const span = monthSpan(pkg.startDate, pkg.endDate);
      if (!span) return sum;
      return sum + (Number(pkg.totalAmount) || 0) / span;
    }, 0);

  const totalBusinessValue =
    payments.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0) +
    packages.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);

  const oneTimeAllTime = payments.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
  const packageAllTime = packages.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
  const avgRevPerOneTimeClient = oneTimeClientKeys.size ? oneTimeAllTime / oneTimeClientKeys.size : 0;
  const avgRevPerPackageClient = packageClientKeys.size ? packageAllTime / packageClientKeys.size : 0;

  /* ---------------- Completion status ---------------------------------- */
  // One-Time Jobs don't carry a separate "job status" field — payment
  // status doubles as the job lifecycle: Paid = Completed, anything else
  // (Partial/Pending) = Active/Running.
  const totalJobs = payments.length;
  const jobsCompleted = payments.filter((p) => p.status === "Paid").length;
  const jobsActive = totalJobs - jobsCompleted;
  const packagesCompleted = packages.filter((p) => p.status === "Completed").length;
  const packagesRunning = packages.filter((p) => p.status === "Active").length;

  /* ---------------- Package duration breakdown -------------------------- */
  const durationBuckets = new Map();
  packages.forEach((pkg) => {
    const span = monthSpan(pkg.startDate, pkg.endDate);
    if (!span) return;
    durationBuckets.set(span, (durationBuckets.get(span) || 0) + 1);
  });
  const packageDuration = Array.from(durationBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([months, count]) => ({
      label: months === 1 ? "1 Month" : `${months} Months`,
      months,
      count
    }));
  const maxDurationCount = packageDuration.reduce((m, d) => Math.max(m, d.count), 0);

  /* ---------------- One-Time -> Package upsell funnel -------------------- */
  const convertedKeys = new Set([...oneTimeClientKeys].filter((k) => packageClientKeys.has(k)));
  const upsellPct = oneTimeClientKeys.size ? Math.round((convertedKeys.size / oneTimeClientKeys.size) * 100) : 0;

  const packageCountByClient = new Map();
  packages.forEach((pkg) => {
    const key = clientKeyOfPackage(pkg);
    if (!key) return;
    packageCountByClient.set(key, (packageCountByClient.get(key) || 0) + 1);
  });
  const repeatClients = Array.from(packageCountByClient.values()).filter((n) => n >= 2).length;
  const repeatPackagePct = packageClientKeys.size ? Math.round((repeatClients / packageClientKeys.size) * 100) : 0;

  /* ---------------- Income by service (category), scoped ---------------- */
  const categoryTotals = {};
  scopedPayments.forEach((p) => {
    categoryTotals[p.category] = (categoryTotals[p.category] || 0) + (Number(p.totalAmount) || 0);
  });
  const categorySum = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const incomeByService = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({
      category,
      amount,
      percent: categorySum > 0 ? Math.round((amount / categorySum) * 100) : 0
    }));

  /* ---------------- Business health signals ------------------------------ */
  const overduePayments =
    payments.filter((p) => (Number(p.pendingAmount) || 0) > 0 && p.dueDate && p.dueDate < todayStr).length +
    packages.filter((p) => (Number(p.pendingAmount) || 0) > 0 && p.paymentDueDate && p.paymentDueDate < todayStr).length;

  const packagesEndingThisMonth = packages.filter(
    (p) => p.status === "Active" && p.endDate && p.endDate.slice(0, 7) === currentMonthKey
  ).length;

  const expectedCollection =
    payments
      .filter((p) => (Number(p.pendingAmount) || 0) > 0 && p.dueDate && p.dueDate.slice(0, 7) === currentMonthKey)
      .reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0) +
    packages
      .filter((p) => (Number(p.pendingAmount) || 0) > 0 && p.paymentDueDate && p.paymentDueDate.slice(0, 7) === currentMonthKey)
      .reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0);

  const totalOutstanding =
    payments.reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0) +
    packages.reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0);

  const followupsToday = leads.filter(
    (l) => l.nextFollowupDate === todayStr && l.status !== "Converted" && l.status !== "Lost"
  ).length;

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const newLeadsThisWeek = leads.filter((l) => l.createdAt && new Date(l.createdAt) >= weekAgo).length;

  return {
    selectedMonth,
    availableMonths,
    clients: {
      total: allClientKeys.size,
      oneTimeOnly: oneTimeOnlyKeys.size,
      package: packageClientKeys.size,
      newThisMonth: newClientsThisMonth
    },
    business: {
      totalValue: totalBusinessValue,
      oneTimeIncome,
      packageIncome,
      mrr,
      avgRevPerOneTimeClient,
      avgRevPerPackageClient
    },
    completion: {
      totalJobs,
      jobsCompleted,
      jobsActive,
      packagesTotal: packages.length,
      packagesCompleted,
      packagesRunning
    },
    packageDuration,
    maxDurationCount,
    upsell: {
      oneTimeClients: oneTimeClientKeys.size,
      convertedClients: convertedKeys.size,
      conversionPercent: upsellPct,
      packageClients: packageClientKeys.size,
      repeatClients,
      repeatPercent: repeatPackagePct
    },
    incomeByService,
    health: {
      overduePayments,
      packagesEndingThisMonth,
      expectedCollection,
      totalOutstanding,
      followupsToday,
      newLeadsThisWeek
    }
  };
}

function groupKey(payment, type) {
  const date = payment.date ? new Date(payment.date) : null;
  switch (type) {
    case "daily":
      return payment.date || "Unknown";
    case "weekly": {
      if (!date || isNaN(date)) return "Unknown";
      const firstDay = new Date(date);
      const day = firstDay.getDay();
      const diff = firstDay.getDate() - day + (day === 0 ? -6 : 1); // Monday start
      firstDay.setDate(diff);
      return firstDay.toISOString().slice(0, 10);
    }
    case "monthly":
      return (payment.date || "").slice(0, 7) || "Unknown";
    case "yearly":
      return (payment.date || "").slice(0, 4) || "Unknown";
    case "category":
      return payment.category || "Uncategorized";
    case "client":
      return payment.clientName || "Unknown";
    default:
      return (payment.date || "").slice(0, 7) || "Unknown";
  }
}

function buildReport(payments, type, status) {
  let list = [...payments];
  if (status) list = list.filter((p) => p.status === status);

  const map = new Map();
  list.forEach((p) => {
    const key = groupKey(p, type);
    if (!map.has(key)) {
      map.set(key, { key, count: 0, totalAmount: 0, paidAmount: 0, pendingAmount: 0 });
    }
    const g = map.get(key);
    g.count += 1;
    g.totalAmount += Number(p.totalAmount) || 0;
    g.paidAmount += Number(p.paidAmount) || 0;
    g.pendingAmount += Number(p.pendingAmount) || 0;
  });

  return Array.from(map.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function csvEscape(val) {
  const str = String(val ?? "");
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function paymentsToCsv(payments) {
  const headers = [
    "ID", "Client", "Mobile", "Business", "Instagram", "Work Details",
    "Category", "Date", "Total", "Paid", "Pending", "Status", "Due Date", "Notes"
  ];
  const rows = payments.map((p) => [
    p.id, p.clientName, p.mobile, p.businessName, p.instagram, p.workDetails,
    p.category, p.date, p.totalAmount, p.paidAmount, p.pendingAmount, p.status, p.dueDate, p.notes
  ]);
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(row.map(csvEscape).join(",")));
  return lines.join("\n");
}

function expensesToCsv(expenses) {
  const headers = ["ID", "Date", "Category", "Amount", "Notes"];
  const rows = expenses.map((e) => [e.id, e.date, e.category, e.amount, e.notes]);
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(row.map(csvEscape).join(",")));
  return lines.join("\n");
}

function leadsToCsv(leads) {
  const headers = [
    "ID", "Name", "Mobile", "Business", "Instagram", "Source",
    "Status", "Expected Value", "Next Follow-up", "Notes", "Created"
  ];
  const rows = leads.map((l) => [
    l.id, l.name, l.mobile, l.businessName, l.instagram, l.source,
    l.status, l.expectedValue, l.nextFollowupDate, l.notes, l.createdAt
  ]);
  const lines = [headers.join(",")];
  rows.forEach((row) => lines.push(row.map(csvEscape).join(",")));
  return lines.join("\n");
}

/* ---------------------------------------------------------------------- */
/* File upload (for restore)                                              */
/* ---------------------------------------------------------------------- */

const upload = multer({ storage: multer.memoryStorage() });

/* ---------------------------------------------------------------------- */
/* Home page                                                              */
/* ---------------------------------------------------------------------- */

app.get("/", async (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/healthz", (req, res) => {
  res.status(dbReady ? 200 : 503).json({
    ok: dbReady,
    db: dbReady ? "connected" : "unreachable",
    error: dbReady ? null : dbLastError
  });
});

// Gate every /api/* call on the database actually being connected, so a
// DB outage returns a clear 503 immediately instead of every route
// hanging on a query that will never resolve.
app.use("/api", (req, res, next) => {
  if (!dbReady) {
    return res.status(503).json({ error: "Database is not connected yet. Try again shortly." });
  }
  next();
});

/* ---------------------------------------------------------------------- */
/* API guard: role check (server par) -> row lock -> activity log         */
/* ---------------------------------------------------------------------- */

app.get("/api/me", (req, res) => {
  const u = req.user;
  res.json({ id: u.id, name: u.name, email: u.email, role: u.role, access: ACCESS[u.role] || {} });
});

// 1) Role check — je list ma nathi e 403.
app.use("/api", (req, res, next) => {
  const need = resolveModule(req);
  const role = req.user.role;
  let allowed = false;
  if (need === AUTH) allowed = true;
  else if (need) {
    const level = accessLevel(role, need);
    allowed = level === F || (level === V && SAFE_METHODS.has(req.method));
  }
  if (!allowed) {
    return res.status(403).json({ error: "Aa kaam mate tamari pase permission nathi." });
  }
  // Jene paisa no access nathi, tena response maanthi paisa na fields kadhi nakho.
  if (!canMoney(role) && /^\/(clients|packages|one-time-jobs|calendar)/.test(req.path)) {
    const orig = res.json.bind(res);
    res.json = (body) => orig(stripMoney(req.path, body));
  }
  next();
});

// ---- Team management (Owner only: module "team") ----------------------
const TEAM_ROLES = ROLES.filter((r) => r !== "owner");
function tempPassword() {
  const a = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.randomBytes(10), (b) => a[b % a.length]).join("");
}
const USER_COLS = "id, email, name, role, active, must_change_password, created_at, last_login_at";

app.get("/api/users", async (req, res) => {
  try {
    res.json((await pool.query(`SELECT ${USER_COLS} FROM users ORDER BY id`)).rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/users", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const role = String(req.body.role || "");
    if (!name) return res.status(400).json({ error: "Naam jaruri che." });
    if (!validEmail(email)) return res.status(400).json({ error: "Sacho email nakho." });
    if (!TEAM_ROLES.includes(role)) return res.status(400).json({ error: "Role sacho nathi." });
    const temp = tempPassword();
    const { rows } = await pool.query(
      `INSERT INTO users (email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,TRUE) RETURNING ${USER_COLS}`,
      [email, name, role, await hashPassword(temp)]
    );
    await logActivity(pool, req.user, "user_created", "user", String(rows[0].id), `${req.user.name} added ${name} (${role})`);
    res.status(201).json({ user: rows[0], tempPassword: temp });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "Aa email thi member pehla thi che." });
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = (await pool.query("SELECT id, name, role, active FROM users WHERE id = $1", [id])).rows[0];
    if (!t) return res.status(404).json({ error: "Member malyo nahi." });
    if (t.role === "owner" || id === req.user.id) return res.status(400).json({ error: "Owner (ane potani jaat) ne aahiya thi badli nathi shakatu." });
    const sets = [], vals = [];
    if (req.body.role !== undefined) {
      if (!TEAM_ROLES.includes(req.body.role)) return res.status(400).json({ error: "Role sacho nathi." });
      vals.push(req.body.role); sets.push(`role = $${vals.length}`);
    }
    if (req.body.active !== undefined) { vals.push(!!req.body.active); sets.push(`active = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: "Kai badalvanu nathi." });
    sets.push("session_version = session_version + 1");
    vals.push(id);
    const { rows } = await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING ${USER_COLS}`, vals);
    await logActivity(pool, req.user, "user_updated", "user", String(id), `${req.user.name} updated ${t.name}: ${Object.entries(req.body).map(([k, v]) => k + "=" + v).join(", ")}`);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/users/:id/reset-password", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const t = (await pool.query("SELECT id, name, role FROM users WHERE id = $1", [id])).rows[0];
    if (!t) return res.status(404).json({ error: "Member malyo nahi." });
    if (t.role === "owner") return res.status(400).json({ error: "Owner no password aahiya thi reset nathi thato." });
    const temp = tempPassword();
    await pool.query("UPDATE users SET password_hash = $1, must_change_password = TRUE, session_version = session_version + 1 WHERE id = $2", [await hashPassword(temp), id]);
    await logActivity(pool, req.user, "password_reset", "user", String(id), `${req.user.name} reset password for ${t.name}`);
    res.json({ tempPassword: temp });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2) Row lock — darek save (POST/PUT/DELETE) ek pachi ek thay, overwrite na thai.
const dbContext = new AsyncLocalStorage();
const reenterDb = (req, res, next) => dbContext.run({ client: req.dbClient }, next);

const ENTITY_LABEL = {
  payments: "payment", expenses: "expense", leads: "lead", "one-time-jobs": "one-time job",
  packages: "package", "calendar-events": "calendar event", categories: "category",
  "lead-sources": "lead source", "expense-categories": "expense category",
  clients: "client", "client-profiles": "client profile", settings: "settings", restore: "backup"
};
const LIST_OF = {
  payments: "payments", expenses: "expenses", leads: "leads", "one-time-jobs": "oneTimeJobs",
  packages: "packages", "calendar-events": "calendarEvents"
};
const inr = (n) => "₹" + Number(n || 0).toLocaleString("en-IN");

function describeEntity(key, o) {
  if (!o) return "";
  switch (key) {
    case "payments": return `${o.clientName || ""} · ${inr(o.totalAmount)}`;
    case "expenses": return `${o.category || ""} · ${inr(o.amount)}`;
    case "leads": return o.name || "";
    case "one-time-jobs":
    case "packages": return `${o.name || ""}${o.clientName ? " (" + o.clientName + ")" : ""}`;
    case "calendar-events": return o.title || "";
    default: return "";
  }
}

const SKIP_DIFF = new Set(["createdAt", "paymentHistory", "platforms", "progress"]);
function diffObjects(before, after) {
  const out = {};
  if (!before || !after || typeof after !== "object") return out;
  for (const k of Object.keys(after)) {
    if (SKIP_DIFF.has(k)) continue;
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b && typeof after[k] !== "object") out[k] = [before[k] ?? null, after[k]];
  }
  return out;
}

function buildActivity(req, res, before, relPath) {
  const segs = relPath.split("/").filter(Boolean);
  const key = segs[0];
  const id = segs[1] ? decodeURIComponent(segs[1]) : null;
  const sub = segs[2];
  const body = res.locals.body;
  const label = ENTITY_LABEL[key] || key;

  if (key === "packages") {
    const pkgBody = body && typeof body === "object" ? body : null;
    const KIND = { post: "Post", reel: "Reel", story: "Story" };
    if (sub === "works") {
      const workId = segs[3] ? decodeURIComponent(segs[3]) : null;
      const wBefore = ((before && before.works) || []).find((w) => w.id === workId);
      const list = (pkgBody && pkgBody.works) || [];
      const wAfter = workId ? list.find((w) => w.id === workId) : list[list.length - 1];
      const w = wAfter || wBefore || {};
      const k = KIND[w.kind] || "Work";
      let text;
      if (req.method === "POST") text = `${k} added: ${w.name}`;
      else if (req.method === "DELETE") text = `${k} removed: ${w.name}`;
      else if (wBefore && wAfter && wBefore.status !== wAfter.status) text = wAfter.status === "Completed" ? `${k} completed: ${w.name}` : `${k} marked ${wAfter.status}: ${w.name}`;
      else text = `${k} updated: ${w.name}`;
      return { action: "work_" + req.method.toLowerCase(), entity: "package", entityId: id, summary: text, details: { work: w.name, kind: w.kind, status: w.status } };
    }
    if (sub === "payments") {
      const last = pkgBody && (pkgBody.paymentHistory || []).slice(-1)[0];
      return { action: req.method === "DELETE" ? "payment_removed" : "payment_added", entity: "package", entityId: id, summary: req.method === "DELETE" ? "Payment removed" : `Payment added: ${inr(last && last.amount)}`, details: null };
    }
    if (req.method === "POST") return { action: "create", entity: "package", entityId: (pkgBody && pkgBody.id) || id, summary: `Package created: ${(pkgBody && pkgBody.name) || ""}`, details: null };
    if (req.method === "DELETE") return { action: "delete", entity: "package", entityId: id, summary: `Package deleted: ${(before && before.name) || ""}`, details: null };
    if (req.method === "PUT") {
      const ch = diffObjects(before, pkgBody);
      ["posts", "reels", "stories"].forEach((k) => {
        const a = before && before[k] && before[k].total;
        const b = pkgBody && pkgBody[k] && pkgBody[k].total;
        if (a !== b) ch[k + " quantity"] = [a ?? null, b ?? null];
      });
      return { action: "update", entity: "package", entityId: id, summary: "Package updated", details: Object.keys(ch).length ? { changes: ch } : null };
    }
  }

  let action, entityId = id, shown = before;
  if (key === "restore") return { action: "restore", entity: "backup", entityId: null, summary: "restored a backup file", details: null };
  if (key === "settings") return { action: "update", entity: "settings", entityId: null, summary: "updated settings", details: { changes: diffObjects(before, body) } };
  if (sub === "duplicate") { action = "duplicate"; entityId = body && body.id || id; shown = body; }
  else if (sub === "convert") { action = "convert"; shown = body && body.lead; entityId = id; }
  else if (sub === "payments") { action = req.method === "DELETE" ? "remove payment entry" : "add payment entry"; shown = body || before; }
  else if (req.method === "POST") { action = "create"; entityId = (body && body.id) || id; shown = body; }
  else if (req.method === "PUT") { action = "update"; shown = body || before; }
  else if (req.method === "DELETE") { action = "delete"; shown = before; }
  else action = req.method.toLowerCase();

  const desc = describeEntity(key, shown) || (!id && body && body.name) || (segs[1] ? "" : (req.body && req.body.name) || "");
  const idText = entityId && typeof entityId === "string" ? ` ${entityId}` : "";
  const summary = `${action} ${label}${idText}${desc ? " (" + desc + ")" : ""}`.trim();
  const changes = action === "update" ? diffObjects(before, body) : null;
  return { action, entity: label, entityId: entityId || null, summary, details: changes && Object.keys(changes).length ? { changes } : null };
}

app.use("/api", async (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const relPath = req.path; // handler pachi Express req.path ma /api pacho umere che, etle atyare j save
  let client;
  let done = false;
  const finish = async (commit) => {
    if (done) return;
    done = true;
    try { await client.query(commit ? "COMMIT" : "ROLLBACK"); } catch (e) { console.error("TX end failed:", e.message); }
    client.release();
  };

  let before = null;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '60s'");
    await client.query("SELECT 1 FROM app_data WHERE id = $1 FOR UPDATE", [ROW_ID]);

    // Delete/update ni pehla nu record yaad rakho (activity log mate)
    const seg = relPath.split("/").filter(Boolean);
    const list = LIST_OF[seg[0]];
    if (list && seg[1]) {
      const raw = (await client.query("SELECT data FROM app_data WHERE id = $1", [ROW_ID])).rows[0];
      const arr = raw && raw.data && raw.data[list];
      before = Array.isArray(arr) ? arr.find((x) => x.id === decodeURIComponent(seg[1])) || null : null;
    } else if (seg[0] === "settings") {
      const raw = (await client.query("SELECT data FROM app_data WHERE id = $1", [ROW_ID])).rows[0];
      before = raw && raw.data ? raw.data.settings : null;
    }
  } catch (err) {
    if (client) await finish(false);
    const busy = /lock timeout/i.test(err.message);
    return res.status(503).json({ error: busy ? "Bijo user save kari rahyo che, thodi vaar pachi try karo." : "Database error: " + err.message });
  }

  req.dbClient = client;

  const origJson = res.json.bind(res);
  res.json = (body) => { res.locals.body = body; return origJson(body); };

  // Response jata pehla commit karo, jethi turant pachi no GET navo data j joe.
  const origEnd = res.end.bind(res);
  res.end = function (...args) {
    if (done || res.locals._ending) return origEnd(...args);
    res.locals._ending = true;
    (async () => {
      try {
        if (res.statusCode < 400) {
          const a = buildActivity(req, res, before, relPath);
          await logActivity(client, req.user, a.action, a.entity, a.entityId, `${req.user.name}: ${a.summary}`, a.details);
          await finish(true);
        } else {
          await finish(false);
        }
        origEnd(...args);
      } catch (err) {
        console.error("Commit failed:", err);
        await finish(false);
        const msg = JSON.stringify({ error: "Save na thayu. Pharithi try karo." });
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader("Content-Length", Buffer.byteLength(msg));
        origEnd(msg);
      }
    })();
    return res;
  };

  dbContext.run({ client }, next);
});

app.get("/api/activity", async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
  const before = parseInt(req.query.before, 10);
  const { rows } = before
    ? await pool.query("SELECT * FROM activity_log WHERE id < $1 ORDER BY id DESC LIMIT $2", [before, limit])
    : await pool.query("SELECT * FROM activity_log ORDER BY id DESC LIMIT $1", [limit]);
  res.json(rows);
});

/* ---------------------------------------------------------------------- */
/* Payments CRUD                                                          */
/* ---------------------------------------------------------------------- */

app.get("/api/payments", async (req, res) => {
  const data = await loadData();
  res.json(data.payments);
});

app.post("/api/payments", async (req, res) => {
  try {
    const data = await loadData();
    const payment = normalizePayment(req.body, {});
    payment.id = nextPaymentId(data.payments);
    payment.createdAt = new Date().toISOString();
    data.payments.push(payment);
    await saveData(data);
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/payments/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.payments.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const updated = normalizePayment(req.body, data.payments[idx]);
    updated.id = data.payments[idx].id;
    retargetClientId(data, data.payments[idx], updated);
    data.payments[idx] = updated;
    await saveData(data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/payments/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.payments.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Payment not found" });
    }
    data.payments.splice(idx, 1);
    await saveData(data);
    res.json({ success: true, message: "Payment deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/payments/:id/duplicate", async (req, res) => {
  try {
    const data = await loadData();
    const original = data.payments.find((p) => p.id === req.params.id);
    if (!original) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const copy = {
      ...original,
      id: nextPaymentId(data.payments),
      createdAt: new Date().toISOString()
    };
    data.payments.push(copy);
    await saveData(data);
    res.json(copy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Clients                                                                */
/* ---------------------------------------------------------------------- */

app.get("/api/clients", async (req, res) => {
  const data = await loadData();
  const month = req.query.month;
  const payments = (month && month !== "all")
    ? data.payments.filter((p) => (p.date || "").slice(0, 7) === month)
    : data.payments;
  res.json(buildClients(payments, data.clientIds));
});

/* ---------------------------------------------------------------------- */
/* Leads                                                                  */
/* ---------------------------------------------------------------------- */

app.get("/api/leads", async (req, res) => {
  const data = await loadData();
  res.json(data.leads);
});

app.post("/api/leads", async (req, res) => {
  try {
    const data = await loadData();
    const lead = normalizeLead(req.body, {});
    lead.id = nextLeadId(data.leads);
    lead.createdAt = new Date().toISOString();
    data.leads.push(lead);
    await saveData(data);
    res.json(lead);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/leads/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.leads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const updated = normalizeLead(req.body, data.leads[idx]);
    updated.id = data.leads[idx].id;
    data.leads[idx] = updated;
    await saveData(data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/leads/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.leads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Lead not found" });
    }
    data.leads.splice(idx, 1);
    await saveData(data);
    res.json({ success: true, message: "Lead deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert a lead into a paying client: creates a payment record from the
// lead's details and marks the lead as "Converted", linking the two so the
// lead keeps a reference to the payment it produced.
app.post("/api/leads/:id/convert", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.leads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Lead not found" });
    }
    const lead = data.leads[idx];

    const payment = normalizePayment(
      {
        clientName: lead.name,
        mobile: lead.mobile,
        businessName: lead.businessName,
        instagram: lead.instagram,
        workDetails: req.body.workDetails || "",
        category: req.body.category || "Other",
        date: req.body.date || new Date().toISOString().slice(0, 10),
        totalAmount: req.body.totalAmount ?? lead.expectedValue,
        paidAmount: req.body.paidAmount ?? 0,
        dueDate: req.body.dueDate || "",
        notes: lead.notes
      },
      {}
    );
    payment.id = nextPaymentId(data.payments);
    payment.createdAt = new Date().toISOString();
    data.payments.push(payment);

    lead.status = "Converted";
    lead.convertedPaymentId = payment.id;
    data.leads[idx] = lead;

    await saveData(data);
    res.json({ lead, payment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/lead-sources", async (req, res) => {
  const data = await loadData();
  res.json(data.leadSources);
});

app.post("/api/lead-sources", async (req, res) => {
  try {
    const data = await loadData();
    const name = (req.body.name || "").toString().trim();
    if (!name) {
      return res.status(400).json({ error: "Source name is required" });
    }
    if (data.leadSources.some((s) => s.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: "Source already exists" });
    }
    data.leadSources.push(name);
    await saveData(data);
    res.json(data.leadSources);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Client Profiles (location + PC/Drive folder path)                      */
/* ---------------------------------------------------------------------- */

/* ---------------------------------------------------------------------- */
/* Agency Calendar                                                        */
/* Automatic events come from existing data (one event per record, so     */
/* they can never be duplicated). Manual events are stored separately.    */
/* ---------------------------------------------------------------------- */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function buildCalendarEvents(data) {
  const events = [];
  const auto = (type, ref, date, title, extra = {}) => {
    if (!DATE_RE.test(date || "")) return;
    events.push({ id: `auto:${type}:${ref}`, source: "auto", type, date, allDay: true, title, ...extra });
  };

  (data.payments || []).forEach((p) => {
    if (p.sourceType) return; // mirrored from a job/package, shown there instead
    if (!(Number(p.pendingAmount) > 0)) return;
    auto("payment", p.id, p.dueDate, `${p.clientName} · ₹${Number(p.pendingAmount).toLocaleString("en-IN")} due`, {
      clientId: p.clientId || "", clientName: p.clientName, notes: p.workDetails || p.notes || "", link: "payments"
    });
  });
  (data.leads || []).forEach((l) => {
    if (l.status === "Converted" || l.status === "Lost") return;
    auto("lead", l.id, l.nextFollowupDate, `Follow-up: ${l.name}`, {
      clientName: l.name, notes: l.notes || "", link: "leads"
    });
  });
  (data.oneTimeJobs || []).forEach((j) => {
    if (j.status === "Completed") return;
    auto("job", j.id, j.dueDate, `Job due: ${j.name}`, {
      clientId: j.clientId || "", clientName: j.clientName, notes: j.notes || "", link: "clients"
    });
  });
  (data.packages || []).forEach((k) => {
    if (k.status === "Completed") return;
    auto("package", k.id, k.endDate, `Package ends: ${k.name}`, {
      clientId: k.clientId || "", clientName: k.clientName, notes: k.notes || "", link: "clients"
    });
  });

  (data.calendarEvents || []).forEach((e) => events.push({ ...e, source: "manual", type: "manual" }));
  return events;
}

function normalizeCalendarEvent(input, existing = {}) {
  const title = (input.title ?? existing.title ?? "").toString().trim();
  const date = (input.date ?? existing.date ?? "").toString().trim();
  if (!title) throw new Error("Title is required");
  if (!DATE_RE.test(date)) throw new Error("Valid date is required");
  const allDay = input.allDay !== undefined ? !!input.allDay : (existing.allDay ?? true);
  const startTime = allDay ? "" : (input.startTime ?? existing.startTime ?? "").toString().trim();
  const endTime = allDay ? "" : (input.endTime ?? existing.endTime ?? "").toString().trim();
  if (startTime && !TIME_RE.test(startTime)) throw new Error("Invalid start time");
  if (endTime && !TIME_RE.test(endTime)) throw new Error("Invalid end time");
  return {
    id: existing.id,
    title,
    date,
    allDay,
    startTime,
    endTime,
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    clientId: (input.clientId ?? existing.clientId ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

app.get("/api/calendar", async (req, res) => {
  try {
    const data = await loadData();
    res.json({ events: buildCalendarEvents(data) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/calendar-events", async (req, res) => {
  try {
    const data = await loadData();
    const ev = normalizeCalendarEvent(req.body);
    ev.id = "EVT-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    data.calendarEvents.push(ev);
    await saveData(data);
    res.status(201).json(ev);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/calendar-events/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.calendarEvents.findIndex((e) => e.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Event not found" });
    const ev = normalizeCalendarEvent(req.body, data.calendarEvents[idx]);
    data.calendarEvents[idx] = ev;
    await saveData(data);
    res.json(ev);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/calendar-events/:id", async (req, res) => {
  try {
    const data = await loadData();
    const before = data.calendarEvents.length;
    data.calendarEvents = data.calendarEvents.filter((e) => e.id !== req.params.id);
    if (data.calendarEvents.length === before) return res.status(404).json({ error: "Event not found" });
    await saveData(data);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Edit a client's contact details everywhere at once. The Client ID stays the same.
app.put("/api/clients/:clientId/details", async (req, res) => {
  try {
    const data = await loadData();
    const clientId = req.params.clientId;
    if (!/^CLI-\d+$/.test(clientId)) return res.status(400).json({ error: "Invalid client ID" });

    const clientName = (req.body.clientName ?? "").toString().trim();
    const mobile = (req.body.mobile ?? "").toString().trim();
    const businessName = req.body.businessName;
    const instagram = req.body.instagram;
    if (!clientName) return res.status(400).json({ error: "Client name is required" });

    const newKey = mobile || clientName;
    const owner = data.clientIds[newKey];
    if (owner && owner !== clientId) {
      return res.status(409).json({ error: `Aa mobile/naam bija client (${owner}) ma pehla thi che` });
    }

    let touched = 0;
    data.payments.forEach((p) => {
      if (p.clientId !== clientId) return;
      p.clientName = clientName;
      p.mobile = mobile;
      if (businessName !== undefined) p.businessName = businessName.toString().trim();
      if (instagram !== undefined) p.instagram = instagram.toString().trim();
      touched++;
    });
    [...data.packages, ...data.oneTimeJobs].forEach((r) => {
      if (r.clientId !== clientId) return;
      r.clientName = clientName;
      r.clientMobile = mobile;
      touched++;
    });
    if (!touched) return res.status(404).json({ error: "Client not found" });

    // Old mobile/name no longer belong to this client; the new one does.
    Object.keys(data.clientIds).forEach((k) => {
      if (data.clientIds[k] === clientId) delete data.clientIds[k];
    });
    data.clientIds[newKey] = clientId;

    await saveData(data);
    const client = buildClients(data.payments, data.clientIds).find((c) => c.clientId === clientId);
    res.json(client || { clientId, clientName, mobile });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/client-profiles", async (req, res) => {
  const data = await loadData();
  res.json(data.clientProfiles);
});

app.put("/api/client-profiles/:key", async (req, res) => {
  try {
    const data = await loadData();
    let key = decodeURIComponent(req.params.key);
    if (!key) return res.status(400).json({ error: "Client key is required" });
    if (!/^CLI-\d+$/.test(key) && data.clientIds[key]) key = data.clientIds[key];
    const existing = data.clientProfiles[key] || {};
    data.clientProfiles[key] = {
      location: (req.body.location ?? existing.location ?? "").toString().trim(),
      folderPath: (req.body.folderPath ?? existing.folderPath ?? "").toString().trim()
    };
    await saveData(data);
    res.json(data.clientProfiles[key]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Mirror Job/Package payment totals into the main `payments` list so the */
/* existing Payments tab / Dashboard / Reports / Export keep working      */
/* unchanged — one mirrored payment row per Job/Package, kept in sync.    */
/* ---------------------------------------------------------------------- */

function syncMirroredPayment(data, entity, sourceType) {
  const idx = data.payments.findIndex((p) => p.sourceType === sourceType && p.sourceId === entity.id);
  const record = {
    id: idx >= 0 ? data.payments[idx].id : nextPaymentId(data.payments),
    clientId: entity.clientId || (idx >= 0 ? data.payments[idx].clientId : "") || "",
    clientName: entity.clientName,
    mobile: entity.clientMobile,
    businessName: idx >= 0 ? data.payments[idx].businessName : "",
    instagram: idx >= 0 ? data.payments[idx].instagram : "",
    workDetails: entity.name,
    category: sourceType === "one-time-job" ? (entity.category || "Other") : (entity.type === "Management" ? "Management" : "Post"),
    date: entity.startDate,
    totalAmount: entity.totalAmount,
    paidAmount: entity.paidAmount,
    pendingAmount: entity.pendingAmount,
    status: entity.paymentStatus,
    dueDate: entity.dueDate || entity.endDate || "",
    notes: entity.notes,
    createdAt: idx >= 0 ? data.payments[idx].createdAt : new Date().toISOString(),
    sourceType,
    sourceId: entity.id
  };
  if (idx >= 0) data.payments[idx] = record;
  else data.payments.push(record);
}

function removeMirroredPayment(data, sourceType, sourceId) {
  data.payments = data.payments.filter((p) => !(p.sourceType === sourceType && p.sourceId === sourceId));
}

/* ---------------------------------------------------------------------- */
/* One-Time Jobs                                                          */
/* ---------------------------------------------------------------------- */

function matchesClient(entity, clientKey) {
  if (!clientKey) return true;
  return entity.clientId === clientKey || entity.clientMobile === clientKey || entity.clientName === clientKey;
}

app.get("/api/one-time-jobs", async (req, res) => {
  const data = await loadData();
  const list = data.oneTimeJobs.filter((j) => matchesClient(j, req.query.client));
  res.json(list);
});

app.get("/api/one-time-jobs/:id", async (req, res) => {
  const data = await loadData();
  const job = data.oneTimeJobs.find((j) => j.id === req.params.id);
  if (!job) return res.status(404).json({ error: "One-time job not found" });
  res.json(job);
});

app.post("/api/one-time-jobs", async (req, res) => {
  try {
    const data = await loadData();
    const job = normalizeOneTimeJob(req.body, {});
    job.id = nextId(data.oneTimeJobs, "JOB");
    job.createdAt = new Date().toISOString();
    data.oneTimeJobs.push(job);
    syncMirroredPayment(data, job, "one-time-job");
    await saveData(data);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/one-time-jobs/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.oneTimeJobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "One-time job not found" });
    const updated = normalizeOneTimeJob(req.body, data.oneTimeJobs[idx]);
    updated.id = data.oneTimeJobs[idx].id;
    retargetClientId(data, data.oneTimeJobs[idx], updated);
    data.oneTimeJobs[idx] = updated;
    syncMirroredPayment(data, updated, "one-time-job");
    await saveData(data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/one-time-jobs/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.oneTimeJobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "One-time job not found" });
    data.oneTimeJobs.splice(idx, 1);
    removeMirroredPayment(data, "one-time-job", req.params.id);
    await saveData(data);
    res.json({ success: true, message: "One-time job deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/one-time-jobs/:id/payments", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.oneTimeJobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "One-time job not found" });
    const entry = normalizePaymentHistoryEntry(req.body, {});
    const job = data.oneTimeJobs[idx];
    job.paymentHistory = [...(job.paymentHistory || []), entry];
    data.oneTimeJobs[idx] = normalizeOneTimeJob(job, job);
    syncMirroredPayment(data, data.oneTimeJobs[idx], "one-time-job");
    await saveData(data);
    res.json(data.oneTimeJobs[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/one-time-jobs/:id/payments/:entryId", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.oneTimeJobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "One-time job not found" });
    const job = data.oneTimeJobs[idx];
    job.paymentHistory = (job.paymentHistory || []).filter((h) => h.id !== req.params.entryId);
    data.oneTimeJobs[idx] = normalizeOneTimeJob(job, job);
    syncMirroredPayment(data, data.oneTimeJobs[idx], "one-time-job");
    await saveData(data);
    res.json(data.oneTimeJobs[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Packages — flat, belongs directly to a Client. type: PostReel |        */
/* Management                                                             */
/* ---------------------------------------------------------------------- */

app.get("/api/packages", async (req, res) => {
  const data = await loadData();
  const list = data.packages.filter((p) => matchesClient(p, req.query.client)).map(enrichPackage);
  res.json(list);
});

app.get("/api/packages/:id", async (req, res) => {
  const data = await loadData();
  const pkg = data.packages.find((p) => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ error: "Package not found" });
  res.json(enrichPackage(pkg));
});

app.post("/api/packages", async (req, res) => {
  try {
    const data = await loadData();
    const pkg = normalizePackage(req.body, {});
    pkg.id = nextId(data.packages, "PKG");
    pkg.createdAt = new Date().toISOString();
    data.packages.push(pkg);
    syncMirroredPayment(data, pkg, "package");
    await saveData(data);
    res.json(enrichPackage(pkg));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/packages/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const updated = normalizePackage(req.body, data.packages[idx]);
    updated.id = data.packages[idx].id;
    retargetClientId(data, data.packages[idx], updated);
    data.packages[idx] = updated;
    syncMirroredPayment(data, updated, "package");
    await saveData(data);
    res.json(enrichPackage(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/packages/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    data.packages.splice(idx, 1);
    removeMirroredPayment(data, "package", req.params.id);
    await saveData(data);
    res.json({ success: true, message: "Package deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Package-level history (who did what) — Owner / Manager only.
app.get("/api/packages/:id/activity", async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, at, user_name, action, summary, details FROM activity_log WHERE entity = 'package' AND entity_id = $1 ORDER BY id DESC LIMIT 200",
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Work records (posts / reels / stories) inside a Post & Reel package ----
app.post("/api/packages/:id/works", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    if (pkg.type === "Management") return res.status(400).json({ error: "Management package ma Posts/Reels/Stories tracking nathi." });
    if (!WORK_KINDS.includes(req.body && req.body.kind)) return res.status(400).json({ error: "kind post, reel ke story hovo joie." });
    const work = normalizeWork(req.body, {});
    work.id = nextId(data.packages.flatMap((p) => p.works || []), "WRK");
    if (!work.name) {
      const n = (pkg.works || []).filter((w) => w.kind === work.kind).length + 1;
      work.name = `${work.kind[0].toUpperCase()}${work.kind.slice(1)} #${n}`;
    }
    data.packages[idx] = normalizePackage({ ...pkg, works: [...(pkg.works || []), work] }, pkg);
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/packages/:id/works/:workId", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    const wIdx = (pkg.works || []).findIndex((w) => w.id === req.params.workId);
    if (wIdx === -1) return res.status(404).json({ error: "Work not found" });
    const works = pkg.works.slice();
    works[wIdx] = normalizeWork({ ...req.body, kind: works[wIdx].kind }, works[wIdx]);
    if (!works[wIdx].name) works[wIdx].name = pkg.works[wIdx].name;
    data.packages[idx] = normalizePackage({ ...pkg, works }, pkg);
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/packages/:id/works/:workId", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    if (!(pkg.works || []).some((w) => w.id === req.params.workId)) return res.status(404).json({ error: "Work not found" });
    data.packages[idx] = normalizePackage({ ...pkg, works: pkg.works.filter((w) => w.id !== req.params.workId) }, pkg);
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/packages/:id/payments", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const entry = normalizePaymentHistoryEntry({ ...req.body, addedBy: (req.user && req.user.name) || "" }, {});
    const pkg = data.packages[idx];
    pkg.paymentHistory = [...(pkg.paymentHistory || []), entry];
    data.packages[idx] = normalizePackage(pkg, pkg);
    syncMirroredPayment(data, data.packages[idx], "package");
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/packages/:id/payments/:entryId", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    pkg.paymentHistory = (pkg.paymentHistory || []).filter((h) => h.id !== req.params.entryId);
    data.packages[idx] = normalizePackage(pkg, pkg);
    syncMirroredPayment(data, data.packages[idx], "package");
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/platform-options", async (req, res) => {
  const data = await loadData();
  res.json(data.platformOptions);
});

/* ---------------------------------------------------------------------- */
/* Client Overview — live counts for the Overview tab                     */
/* ---------------------------------------------------------------------- */

app.get("/api/clients/:key/overview", async (req, res) => {
  const data = await loadData();
  const key = decodeURIComponent(req.params.key);
  const jobs = data.oneTimeJobs.filter((j) => matchesClient(j, key));
  const pkgs = data.packages.filter((p) => matchesClient(p, key));

  const countBy = (list, statuses) => {
    const out = { total: list.length, paymentPending: list.filter((x) => x.paymentStatus !== "Paid").length };
    statuses.forEach((s) => {
      out[s] = list.filter((x) => x.status === s).length;
    });
    return out;
  };

  res.json({
    clientId: /^CLI-\d+$/.test(key) ? key : (data.clientIds[key] || ""),
    oneTime: countBy(jobs, ["Active", "In Progress", "On Hold", "Completed"]),
    packages: countBy(pkgs, ["Active", "On Hold", "Completed"])
  });
});



/* ---------------------------------------------------------------------- */
/* WORK — migrated from legacy AgencyOS                                 */
/* ---------------------------------------------------------------------- */
const WORK_STAGES = ["Shoot Planned","Assigned to Editor","Upload","Revision","Completed"];
const nextWorkId = (list, prefix) => {
  let max = 1000;
  for (const x of list || []) { const m = new RegExp(`^${prefix}-(\\d+)$`).exec(String(x.id || "")); if (m) max = Math.max(max, Number(m[1])); }
  return `${prefix}-${max + 1}`;
};
const cleanText = (v, fallback="") => String(v ?? fallback).trim();

app.get("/api/work/summary", async (req,res) => {
  const d=await loadData();
  const today=new Date().toISOString().slice(0,10);
  res.json({
    production:{total:d.contentProduction.length,active:d.contentProduction.filter(x=>x.stage!=="Completed").length,completed:d.contentProduction.filter(x=>x.stage==="Completed").length,overdue:d.contentProduction.filter(x=>x.stage!=="Completed" && (x.dueDate||"")<today && x.dueDate).length},
    shoots:{total:d.shoots.length,planned:d.shoots.filter(x=>x.status==="Planned").length,completed:d.shoots.filter(x=>x.status==="Completed").length},
    social:{posts:d.socialMediaPosts.length,published:d.socialMediaPosts.filter(x=>x.status==="Published").length,pending:d.socialMediaPosts.filter(x=>x.status!=="Published").length,cycles:d.monthlyCycles.length},
    festival:{total:d.festivalOrders.length,pending:d.festivalOrders.filter(x=>x.stage!=="Completed").length,completed:d.festivalOrders.filter(x=>x.stage==="Completed").length}
  });
});

app.get("/api/production", async (req,res)=>{
  const d=await loadData(); let a=d.contentProduction.slice();
  const q=cleanText(req.query.search).toLowerCase(), stage=cleanText(req.query.stage), editor=cleanText(req.query.editor);
  if(q) a=a.filter(x=>[x.clientName,x.contentTitle,x.type,x.platform,x.shootCategory,x.editor,x.shootBy].some(v=>String(v||"").toLowerCase().includes(q)));
  if(stage && stage!=="all") a=a.filter(x=>x.stage===stage);
  if(editor && editor!=="all") a=a.filter(x=>(x.editor||"")===editor);
  a.sort((x,y)=>String(y.createdAt||"").localeCompare(String(x.createdAt||"")));
  res.json(a);
});
app.get("/api/production/:id", async (req,res)=>{ const d=await loadData(); const x=d.contentProduction.find(x=>x.id===req.params.id); if(!x)return res.status(404).json({error:"Content not found"}); res.json(x); });
app.post("/api/production", async (req,res)=>{
  const d=await loadData(), b=req.body||{}; const item={
    id:nextWorkId(d.contentProduction,"CP"), clientId:cleanText(b.clientId), clientName:cleanText(b.clientName,"Unknown Client"), clientMobile:cleanText(b.clientMobile),
    contentTitle:cleanText(b.contentTitle,"Untitled Content"), type:cleanText(b.type,"Reel"), shootCategory:cleanText(b.shootCategory,"Other"), platform:cleanText(b.platform,"Instagram"),
    stage:WORK_STAGES.includes(b.stage)?b.stage:"Shoot Planned", shootPlannedDate:cleanText(b.shootPlannedDate), shootDate:cleanText(b.shootDate), shootBy:cleanText(b.shootBy,"Dasev"),
    editor:cleanText(b.editor), assignedDate:cleanText(b.assignedDate), dueDate:cleanText(b.dueDate), priority:cleanText(b.priority,"Medium"), notes:cleanText(b.notes), aspectRatio:cleanText(b.aspectRatio,"9:16"), reelNumber:cleanText(b.reelNumber),
    activity:[{id:`ACT-${Date.now()}`,timestamp:new Date().toISOString(),action:`Content created — ${cleanText(b.contentTitle,"Untitled Content")}`}], revisionHistory:[], createdAt:new Date().toISOString().slice(0,10)
  }; d.contentProduction.unshift(item); await saveData(d); res.status(201).json(item);
});
app.put("/api/production/:id", async (req,res)=>{ const d=await loadData(), i=d.contentProduction.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Content not found"}); const before=d.contentProduction[i]; d.contentProduction[i]={...before,...req.body,id:before.id,activity:before.activity||[],revisionHistory:before.revisionHistory||[]}; await saveData(d); res.json(d.contentProduction[i]); });
app.patch("/api/production/:id/stage", async (req,res)=>{ const d=await loadData(), i=d.contentProduction.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Content not found"}); const x=d.contentProduction[i], next=cleanText(req.body.stage); if(!WORK_STAGES.includes(next))return res.status(400).json({error:"Invalid stage"}); x.activity=[...(x.activity||[]),{id:`ACT-${Date.now()}`,timestamp:new Date().toISOString(),action:`Stage changed: ${x.stage} → ${next}`}]; x.stage=next; if(next==="Completed")x.completedDate=new Date().toISOString().slice(0,10); await saveData(d); res.json(x); });
app.post("/api/production/:id/revisions", async (req,res)=>{ const d=await loadData(), i=d.contentProduction.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Content not found"}); const x=d.contentProduction[i], r={id:`REV-${Date.now()}`,revisionNumber:(x.revisionHistory||[]).length+1,requestedBy:cleanText(req.body.requestedBy,"Client"),feedback:cleanText(req.body.feedback),status:"Open",createdAt:new Date().toISOString()}; x.revisionHistory=[...(x.revisionHistory||[]),r]; x.stage="Revision"; await saveData(d); res.status(201).json(r); });
app.patch("/api/production/:id/revisions/:rid", async(req,res)=>{ const d=await loadData(), i=d.contentProduction.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Content not found"}); const x=d.contentProduction[i],r=(x.revisionHistory||[]).find(r=>r.id===req.params.rid); if(!r)return res.status(404).json({error:"Revision not found"}); Object.assign(r,req.body); await saveData(d); res.json(r); });
app.post("/api/production/:id/duplicate", async(req,res)=>{ const d=await loadData(), src=d.contentProduction.find(x=>x.id===req.params.id); if(!src)return res.status(404).json({error:"Content not found"}); const copy={...src,id:nextWorkId(d.contentProduction,"CP"),contentTitle:`${src.contentTitle} — Copy`,stage:"Shoot Planned",createdAt:new Date().toISOString().slice(0,10),activity:[],revisionHistory:[]}; d.contentProduction.unshift(copy); await saveData(d); res.status(201).json(copy); });
app.delete("/api/production/:id", async(req,res)=>{ const d=await loadData(),i=d.contentProduction.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Content not found"}); d.contentProduction.splice(i,1); await saveData(d); res.json({success:true}); });

app.get("/api/shoots", async(req,res)=>{ const d=await loadData(); let a=d.shoots.slice(); const q=cleanText(req.query.search).toLowerCase(); if(q)a=a.filter(x=>[x.title,x.clientName,x.location,x.shootType].some(v=>String(v||"").toLowerCase().includes(q))); res.json(a.sort((x,y)=>String(y.shootDate||"").localeCompare(String(x.shootDate||"")))); });
app.get("/api/shoots/:id", async(req,res)=>{ const d=await loadData(),x=d.shoots.find(x=>x.id===req.params.id); if(!x)return res.status(404).json({error:"Shoot not found"}); res.json({...x,linkedContentItems:d.contentProduction.filter(c=>c.shootId===x.id||(x.linkedContentIds||[]).includes(c.id))}); });
app.post("/api/shoots", async(req,res)=>{ const d=await loadData(),b=req.body||{},x={id:nextWorkId(d.shoots,"SHT"),clientId:cleanText(b.clientId),clientName:cleanText(b.clientName,"Unknown Client"),clientMobile:cleanText(b.clientMobile),title:cleanText(b.title,"Content Shoot"),shootType:cleanText(b.shootType,"Reels Batch"),shootDate:cleanText(b.shootDate),callTime:cleanText(b.callTime),wrapTime:cleanText(b.wrapTime),location:cleanText(b.location),status:cleanText(b.status,"Planned"),crew:Array.isArray(b.crew)?b.crew:[],gearChecklist:Array.isArray(b.gearChecklist)?b.gearChecklist:[],plannedDeliverables:b.plannedDeliverables||{reelsCount:0,photosCount:0,longVideosCount:0,shotListNotes:""},driveLinks:b.driveLinks||{},expenses:Array.isArray(b.expenses)?b.expenses:[],linkedContentIds:[],notes:cleanText(b.notes),createdAt:new Date().toISOString().slice(0,10)}; d.shoots.unshift(x); await saveData(d); res.status(201).json(x); });
app.put("/api/shoots/:id", async(req,res)=>{ const d=await loadData(),i=d.shoots.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Shoot not found"}); d.shoots[i]={...d.shoots[i],...req.body,id:d.shoots[i].id}; await saveData(d); res.json(d.shoots[i]); });
app.patch("/api/shoots/:id/status", async(req,res)=>{ const d=await loadData(),x=d.shoots.find(x=>x.id===req.params.id); if(!x)return res.status(404).json({error:"Shoot not found"}); x.status=cleanText(req.body.status,x.status); await saveData(d); res.json(x); });
app.post("/api/shoots/:id/create-content-items", async(req,res)=>{ const d=await loadData(),x=d.shoots.find(x=>x.id===req.params.id); if(!x)return res.status(404).json({error:"Shoot not found"}); const titles=Array.isArray(req.body.titles)?req.body.titles:[]; const n=Math.max(titles.length,Number(req.body.count)||Number(x.plannedDeliverables?.reelsCount)||0); const made=[]; for(let i=0;i<n;i++){const c={id:nextWorkId([...d.contentProduction,...made],"CP"),clientId:x.clientId,clientName:x.clientName,clientMobile:x.clientMobile,contentTitle:titles[i]||`${x.title} - Reel #${i+1}`,type:"Reel",shootCategory:"Other",platform:"Instagram",stage:"Shoot Planned",shootPlannedDate:x.shootDate,shootDate:x.shootDate,shootBy:(x.crew?.[0]?.name)||"Dasev",editor:"",dueDate:"",priority:"Medium",notes:`Generated from Shoot ${x.id}`,aspectRatio:"9:16",reelNumber:`#${i+1}`,shootId:x.id,activity:[],revisionHistory:[],createdAt:new Date().toISOString().slice(0,10)}; d.contentProduction.unshift(c); made.push(c); x.linkedContentIds=[...(x.linkedContentIds||[]),c.id]; } await saveData(d); res.status(201).json({createdItems:made,shoot:x}); });
app.delete("/api/shoots/:id", async(req,res)=>{ const d=await loadData(),i=d.shoots.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Shoot not found"}); d.shoots.splice(i,1); await saveData(d); res.json({success:true}); });

app.get("/api/designs", async(req,res)=>{ const d=await loadData(); let a=d.designs.slice(); const q=cleanText(req.query.search).toLowerCase(); if(q)a=a.filter(x=>[x.title,x.clientName,x.category,x.designer,x.stage].some(v=>String(v||"").toLowerCase().includes(q))); res.json(a); });
app.post("/api/designs", async(req,res)=>{ const d=await loadData(),b=req.body||{},x={id:nextWorkId(d.designs,"DES"),clientId:cleanText(b.clientId),clientName:cleanText(b.clientName,"Unknown Client"),clientMobile:cleanText(b.clientMobile),title:cleanText(b.title,"Untitled Design"),category:cleanText(b.category,"Post"),aspectRatio:cleanText(b.aspectRatio,"4:5"),designer:cleanText(b.designer,"Unassigned"),stage:cleanText(b.stage,"Brief"),priority:cleanText(b.priority,"Medium"),dates:b.dates||{},driveLinks:b.driveLinks||{},revisions:Array.isArray(b.revisions)?b.revisions:[],waitingOn:cleanText(b.waitingOn,"None"),specifications:cleanText(b.specifications),notes:cleanText(b.notes),createdAt:new Date().toISOString().slice(0,10)}; d.designs.unshift(x); await saveData(d); res.status(201).json(x); });
app.put("/api/designs/:id", async(req,res)=>{ const d=await loadData(),i=d.designs.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Design not found"}); d.designs[i]={...d.designs[i],...req.body,id:d.designs[i].id}; await saveData(d); res.json(d.designs[i]); });
app.delete("/api/designs/:id", async(req,res)=>{ const d=await loadData(),i=d.designs.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Design not found"}); d.designs.splice(i,1); await saveData(d); res.json({success:true}); });

app.get("/api/social-media/posts", async(req,res)=>{ const d=await loadData(); let a=d.socialMediaPosts.slice(); const q=cleanText(req.query.search).toLowerCase(); if(q)a=a.filter(x=>[x.title,x.clientName,x.platform,x.contentType,x.status].some(v=>String(v||"").toLowerCase().includes(q))); res.json(a); });
app.post("/api/social-media/posts", async(req,res)=>{ const d=await loadData(),b=req.body||{},x={id:nextWorkId(d.socialMediaPosts,"SMP"),clientId:cleanText(b.clientId),clientName:cleanText(b.clientName,"Unknown Client"),clientMobile:cleanText(b.clientMobile),platform:cleanText(b.platform,"Instagram"),contentType:cleanText(b.contentType,"Post"),title:cleanText(b.title,"Untitled Post"),caption:cleanText(b.caption),hashtags:cleanText(b.hashtags),scheduledDate:cleanText(b.scheduledDate),scheduledTime:cleanText(b.scheduledTime),status:cleanText(b.status,"Draft"),linkedProductionId:cleanText(b.linkedProductionId),mediaAssetUrl:cleanText(b.mediaAssetUrl),accountManager:cleanText(b.accountManager),notes:cleanText(b.notes),createdAt:new Date().toISOString().slice(0,10)}; d.socialMediaPosts.unshift(x); await saveData(d); res.status(201).json(x); });
app.put("/api/social-media/posts/:id", async(req,res)=>{ const d=await loadData(),i=d.socialMediaPosts.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Social post not found"}); d.socialMediaPosts[i]={...d.socialMediaPosts[i],...req.body,id:d.socialMediaPosts[i].id}; await saveData(d); res.json(d.socialMediaPosts[i]); });
app.delete("/api/social-media/posts/:id", async(req,res)=>{ const d=await loadData(),i=d.socialMediaPosts.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Social post not found"}); d.socialMediaPosts.splice(i,1); await saveData(d); res.json({success:true}); });

/* ---------------------------------------------------------------------- */
/* Social Media Management — package-wise client tracking                 */
/* ---------------------------------------------------------------------- */
function smMonthKey(value){
  const v=String(value||"").trim();
  if(/^\d{4}-\d{2}$/.test(v)) return v;
  const d=new Date(v);
  if(!Number.isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
  const m=v.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if(m){ const n=new Date(`${m[1]} 1, ${m[2]}`); if(!Number.isNaN(n.getTime())) return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; }
  const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
}
function smMonthLabel(key){ const [y,m]=smMonthKey(key).split("-").map(Number); return new Date(y,m-1,1).toLocaleString("en-IN",{month:"long",year:"numeric"}); }
function smEnsureCycle(pkg, data, monthKey){
  const key=smMonthKey(monthKey);
  let c=(data.monthlyCycles||[]).find(x=>String(x.packageId||"")===String(pkg.id) && smMonthKey(x.monthKey||x.month)===key);
  if(c) return c;
  const pTargets=(pkg.platforms||[]).reduce((a,p)=>({posts:a.posts+Number(p.posts)||0,reels:a.reels+Number(p.reels)||0,stories:a.stories+Number(p.stories)||0}),{posts:0,reels:0,stories:0});
  c={id:`CYC-SM-${Date.now()}`,packageId:pkg.id,packageName:pkg.name,clientId:pkg.clientId||"",clientName:pkg.clientName,clientMobile:pkg.clientMobile,monthKey:key,month:smMonthLabel(key),stage:"Plan",status:"Active",targets:{...pTargets,shoots:0},completed:{posts:0,reels:0,stories:0,shoots:0},adsIncluded:false,agencyAdFee:0,clientAdBudget:0,actualAdSpend:0,adCampaigns:[],contentItems:[],performance:{reach:0,impressions:0,messages:0,leads:0,profileVisits:0,engagements:0},activity:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  data.monthlyCycles.unshift(c); return c;
}
function smCycleStats(c){
  const items=Array.isArray(c?.contentItems)?c.contentItems:[];
  const by=(kind)=>{const a=items.filter(x=>String(x.contentType||"").toLowerCase()===kind); const published=a.filter(x=>x.status==="Published").length; return {total:Number(c?.targets?.[kind+"s"])||0,created:a.length,published,pending:Math.max(0,(Number(c?.targets?.[kind+"s"])||0)-published)};};
  const posts=by("post"), reels=by("reel"), stories=by("story");
  const ads=Array.isArray(c?.adCampaigns)?c.adCampaigns:[];
  const spend=ads.reduce((n,a)=>n+(Number(a.actualSpend)||0),0);
  return {posts,reels,stories,shoots:{total:Number(c?.targets?.shoots)||0,done:Number(c?.completed?.shoots)||0},published:posts.published+reels.published+stories.published,boosted:items.filter(x=>x.boosted).length,adSpend:spend,adBudget:Number(c?.clientAdBudget)||0,remainingAdBudget:Math.max(0,(Number(c?.clientAdBudget)||0)-spend),ads};
}
app.get("/api/social-management/packages", async(req,res)=>{
  try{ const d=await loadData(); const month=smMonthKey(req.query.month); const list=d.packages.filter(p=>p.type==="Management" && (!req.query.search || `${p.clientName} ${p.name}`.toLowerCase().includes(String(req.query.search).toLowerCase()))).map(p=>{const c=smEnsureCycle(p,d,month); const st=smCycleStats(c); return {...p,monthKey:month,cycleId:c.id,stats:st};}); if(list.length) await saveData(d); res.json(list); }catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/social-management/packages/:id/dashboard", async(req,res)=>{
  try{ const d=await loadData(); const p=d.packages.find(x=>x.id===req.params.id && x.type==="Management"); if(!p)return res.status(404).json({error:"Management package not found"}); const month=smMonthKey(req.query.month); const c=smEnsureCycle(p,d,month); if(!c.contentItems) c.contentItems=[]; if(!c.adCampaigns)c.adCampaigns=[]; if(!c.performance)c.performance={reach:0,impressions:0,messages:0,leads:0,profileVisits:0,engagements:0}; if(!c.activity)c.activity=[]; const st=smCycleStats(c); if(st.adSpend!==Number(c.actualAdSpend||0))c.actualAdSpend=st.adSpend; await saveData(d); res.json({package:p,cycle:c,stats:st,history:d.monthlyCycles.filter(x=>x.packageId===p.id).sort((a,b)=>String(b.monthKey||b.month).localeCompare(String(a.monthKey||a.month))).map(x=>({monthKey:x.monthKey||smMonthKey(x.month),month:x.month,stage:x.stage,status:x.status,stats:smCycleStats(x)}))}); }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/social-management/packages/:id/cycles", async(req,res)=>{
  try{const d=await loadData(); const p=d.packages.find(x=>x.id===req.params.id&&x.type==="Management"); if(!p)return res.status(404).json({error:"Management package not found"}); const key=smMonthKey(req.body.monthKey||req.body.month); const existing=d.monthlyCycles.find(x=>x.packageId===p.id&&smMonthKey(x.monthKey||x.month)===key); if(existing)return res.status(409).json({error:"Aa month nu cycle already exists"}); const c=smEnsureCycle({...p,platforms:p.platforms},d,key); c.targets={posts:Number(req.body.targets?.posts)||0,reels:Number(req.body.targets?.reels)||0,stories:Number(req.body.targets?.stories)||0,shoots:Number(req.body.targets?.shoots)||0}; c.clientAdBudget=Number(req.body.clientAdBudget)||0;c.agencyAdFee=Number(req.body.agencyAdFee)||0;c.adsIncluded=!!req.body.adsIncluded;c.notes=cleanText(req.body.notes);await saveData(d);res.status(201).json(c);}catch(e){res.status(500).json({error:e.message});}
});
app.put("/api/social-management/cycles/:id", async(req,res)=>{try{const d=await loadData();const c=d.monthlyCycles.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:"Cycle not found"});Object.assign(c,req.body,{id:c.id,updatedAt:new Date().toISOString()});if(req.body.monthKey)c.month=smMonthLabel(req.body.monthKey);await saveData(d);res.json(c);}catch(e){res.status(500).json({error:e.message});}});
app.post("/api/social-management/cycles/:id/content", async(req,res)=>{try{const d=await loadData();const c=d.monthlyCycles.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:"Cycle not found"});const b=req.body||{};const type=["Post","Reel","Story"].includes(b.contentType)?b.contentType:"Post";const x={id:`SMC-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,clientId:c.clientId,clientName:c.clientName,packageId:c.packageId,cycleId:c.id,title:cleanText(b.title,"Untitled Content"),contentType:type,platform:cleanText(b.platform,"Instagram"),status:cleanText(b.status,"Planned"),scheduledDate:cleanText(b.scheduledDate),scheduledTime:cleanText(b.scheduledTime),assignedTo:cleanText(b.assignedTo),editor:cleanText(b.editor),mediaAssetUrl:cleanText(b.mediaAssetUrl),caption:cleanText(b.caption),hashtags:cleanText(b.hashtags),linkedProductionId:cleanText(b.linkedProductionId),boosted:!!b.boosted,boostSpend:Number(b.boostSpend)||0,notes:cleanText(b.notes),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};c.contentItems=Array.isArray(c.contentItems)?c.contentItems:[];c.contentItems.unshift(x);c.activity=Array.isArray(c.activity)?c.activity:[];c.activity.unshift({at:new Date().toISOString(),action:"Content added",summary:`${type}: ${x.title}`});await saveData(d);res.status(201).json(x);}catch(e){res.status(500).json({error:e.message});}});
app.put("/api/social-management/content/:id", async(req,res)=>{try{const d=await loadData();let found;for(const c of d.monthlyCycles||[]){const i=(c.contentItems||[]).findIndex(x=>x.id===req.params.id);if(i>=0){c.contentItems[i]={...c.contentItems[i],...req.body,id:req.params.id,updatedAt:new Date().toISOString()};found=c.contentItems[i];break;}}if(!found)return res.status(404).json({error:"Content not found"});await saveData(d);res.json(found);}catch(e){res.status(500).json({error:e.message});}});
app.delete("/api/social-management/content/:id", async(req,res)=>{try{const d=await loadData();for(const c of d.monthlyCycles||[]){const i=(c.contentItems||[]).findIndex(x=>x.id===req.params.id);if(i>=0){c.contentItems.splice(i,1);await saveData(d);return res.json({success:true});}}res.status(404).json({error:"Content not found"});}catch(e){res.status(500).json({error:e.message});}});
app.post("/api/social-management/cycles/:id/ads", async(req,res)=>{try{const d=await loadData();const c=d.monthlyCycles.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:"Cycle not found"});const b=req.body||{};const a={id:`ADS-${Date.now()}`,campaign:cleanText(b.campaign,"Untitled Campaign"),platform:cleanText(b.platform,"Instagram"),contentId:cleanText(b.contentId),objective:cleanText(b.objective,"Engagement"),startDate:cleanText(b.startDate),endDate:cleanText(b.endDate),plannedBudget:Number(b.plannedBudget)||0,actualSpend:Number(b.actualSpend)||0,status:cleanText(b.status,"Running"),reach:Number(b.reach)||0,impressions:Number(b.impressions)||0,messages:Number(b.messages)||0,leads:Number(b.leads)||0,profileVisits:Number(b.profileVisits)||0,engagements:Number(b.engagements)||0,notes:cleanText(b.notes),createdAt:new Date().toISOString()};c.adCampaigns=Array.isArray(c.adCampaigns)?c.adCampaigns:[];c.adCampaigns.unshift(a);c.actualAdSpend=c.adCampaigns.reduce((n,x)=>n+(Number(x.actualSpend)||0),0);await saveData(d);res.status(201).json(a);}catch(e){res.status(500).json({error:e.message});}});
app.put("/api/social-management/ads/:id", async(req,res)=>{try{const d=await loadData();let found;for(const c of d.monthlyCycles||[]){const i=(c.adCampaigns||[]).findIndex(x=>x.id===req.params.id);if(i>=0){c.adCampaigns[i]={...c.adCampaigns[i],...req.body,id:req.params.id};c.actualAdSpend=c.adCampaigns.reduce((n,x)=>n+(Number(x.actualSpend)||0),0);found=c.adCampaigns[i];break;}}if(!found)return res.status(404).json({error:"Campaign not found"});await saveData(d);res.json(found);}catch(e){res.status(500).json({error:e.message});}});
app.delete("/api/social-management/ads/:id", async(req,res)=>{try{const d=await loadData();for(const c of d.monthlyCycles||[]){const i=(c.adCampaigns||[]).findIndex(x=>x.id===req.params.id);if(i>=0){c.adCampaigns.splice(i,1);c.actualAdSpend=c.adCampaigns.reduce((n,x)=>n+(Number(x.actualSpend)||0),0);await saveData(d);return res.json({success:true});}}res.status(404).json({error:"Campaign not found"});}catch(e){res.status(500).json({error:e.message});}});
app.put("/api/social-management/cycles/:id/performance", async(req,res)=>{try{const d=await loadData();const c=d.monthlyCycles.find(x=>x.id===req.params.id);if(!c)return res.status(404).json({error:"Cycle not found"});c.performance={...(c.performance||{}),reach:Number(req.body.reach)||0,impressions:Number(req.body.impressions)||0,messages:Number(req.body.messages)||0,leads:Number(req.body.leads)||0,profileVisits:Number(req.body.profileVisits)||0,engagements:Number(req.body.engagements)||0};await saveData(d);res.json(c.performance);}catch(e){res.status(500).json({error:e.message});}});

app.get("/api/monthly-cycles", async(req,res)=>{ const d=await loadData(); res.json(d.monthlyCycles); });
app.post("/api/monthly-cycles", async(req,res)=>{ const d=await loadData(),b=req.body||{},month=cleanText(b.month,new Date().toLocaleString("en-IN",{month:"long",year:"numeric"})); const x={id:`CYC-${month.replace(/[^0-9A-Za-z]/g,"")}-${Date.now().toString().slice(-4)}`,...b,month,status:b.status||"Active",stage:b.stage||"Plan",targets:b.targets||{posts:0,reels:0,stories:0,shoots:0},completed:b.completed||{posts:0,reels:0,stories:0,shoots:0},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; d.monthlyCycles.unshift(x); await saveData(d); res.status(201).json(x); });
app.put("/api/monthly-cycles/:id", async(req,res)=>{ const d=await loadData(),i=d.monthlyCycles.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Cycle not found"}); d.monthlyCycles[i]={...d.monthlyCycles[i],...req.body,id:d.monthlyCycles[i].id,updatedAt:new Date().toISOString()}; await saveData(d); res.json(d.monthlyCycles[i]); });

app.get("/api/festival-orders", async(req,res)=>{ const d=await loadData(); let a=d.festivalOrders.slice(); const q=cleanText(req.query.search).toLowerCase(); if(q)a=a.filter(x=>[x.clientName,x.businessName,x.clientMobile,x.stage,x.paymentStatus,x.deliveryStatus].some(v=>String(v||"").toLowerCase().includes(q))); res.json(a); });
app.post("/api/festival-orders", async(req,res)=>{ const d=await loadData(),b=req.body||{},x={id:`FEST-${Date.now()}`,clientName:cleanText(b.clientName),businessName:cleanText(b.businessName),clientMobile:cleanText(b.clientMobile),instagram:cleanText(b.instagram),plan:cleanText(b.plan,"₹299"),amount:Number(b.amount)||0,paidAmount:Number(b.paidAmount)||0,pendingAmount:Math.max(0,(Number(b.amount)||0)-(Number(b.paidAmount)||0)),paymentStatus:cleanText(b.paymentStatus,"Pending"),deliveryStatus:cleanText(b.deliveryStatus,"Pending"),stage:cleanText(b.stage,"New"),createdDate:new Date().toISOString().slice(0,10),driveLink:cleanText(b.driveLink),sentDate:cleanText(b.sentDate),completedDate:cleanText(b.completedDate),notes:cleanText(b.notes),activity:[]}; d.festivalOrders.unshift(x); await saveData(d); res.status(201).json(x); });
app.put("/api/festival-orders/:id", async(req,res)=>{ const d=await loadData(),i=d.festivalOrders.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Festival order not found"}); const x={...d.festivalOrders[i],...req.body,id:d.festivalOrders[i].id}; x.pendingAmount=Math.max(0,(Number(x.amount)||0)-(Number(x.paidAmount)||0)); d.festivalOrders[i]=x; await saveData(d); res.json(x); });
app.delete("/api/festival-orders/:id", async(req,res)=>{ const d=await loadData(),i=d.festivalOrders.findIndex(x=>x.id===req.params.id); if(i<0)return res.status(404).json({error:"Festival order not found"}); d.festivalOrders.splice(i,1); await saveData(d); res.json({success:true}); });

/* ---------------------------------------------------------------------- */
/* Categories                                                             */
/* ---------------------------------------------------------------------- */

app.get("/api/categories", async (req, res) => {
  const data = await loadData();
  res.json(data.categories);
});

app.post("/api/categories", async (req, res) => {
  try {
    const data = await loadData();
    const name = (req.body.name || "").toString().trim();
    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }
    if (data.categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: "Category already exists" });
    }
    data.categories.push(name);
    await saveData(data);
    res.json(data.categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories/:name", async (req, res) => {
  try {
    const data = await loadData();
    const name = decodeURIComponent(req.params.name);
    const idx = data.categories.findIndex((c) => c === name);
    if (idx === -1) {
      return res.status(404).json({ error: "Category not found" });
    }
    data.categories.splice(idx, 1);
    await saveData(data);
    res.json(data.categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Expenses                                                               */
/* ---------------------------------------------------------------------- */

app.get("/api/expenses", async (req, res) => {
  const data = await loadData();
  res.json(data.expenses);
});

app.post("/api/expenses", async (req, res) => {
  try {
    const data = await loadData();
    const expense = normalizeExpense(req.body, {});
    expense.id = nextExpenseId(data.expenses);
    expense.createdAt = new Date().toISOString();
    data.expenses.push(expense);
    await saveData(data);
    res.json(expense);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/expenses/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.expenses.findIndex((e) => e.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Expense not found" });
    }
    const updated = normalizeExpense(req.body, data.expenses[idx]);
    updated.id = data.expenses[idx].id;
    data.expenses[idx] = updated;
    await saveData(data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/expenses/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.expenses.findIndex((e) => e.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Expense not found" });
    }
    data.expenses.splice(idx, 1);
    await saveData(data);
    res.json({ success: true, message: "Expense deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/expense-categories", async (req, res) => {
  const data = await loadData();
  res.json(data.expenseCategories);
});

app.post("/api/expense-categories", async (req, res) => {
  try {
    const data = await loadData();
    const name = (req.body.name || "").toString().trim();
    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }
    if (data.expenseCategories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: "Category already exists" });
    }
    data.expenseCategories.push(name);
    await saveData(data);
    res.json(data.expenseCategories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Settings                                                               */
/* ---------------------------------------------------------------------- */

app.get("/api/settings", async (req, res) => {
  const data = await loadData();
  res.json(data.settings);
});

app.put("/api/settings", async (req, res) => {
  try {
    const data = await loadData();
    data.settings = { ...data.settings, ...req.body };
    await saveData(data);
    res.json(data.settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Dashboard                                                              */
/* ---------------------------------------------------------------------- */

app.get("/api/dashboard", async (req, res) => {
  const data = await loadData();
  res.json(buildDashboard(data.payments, req.query.month));
});

/* ---------------------------------------------------------------------- */
/* Overview — computed analytics (derives from payments + packages+leads) */
/* ---------------------------------------------------------------------- */

app.get("/api/overview", async (req, res) => {
  const data = await loadData();
  res.json(buildOverview(data, req.query.month));
});

/* ---------------------------------------------------------------------- */
/* Reports                                                                */
/* ---------------------------------------------------------------------- */

// Optional date range (YYYY-MM-DD) on the payment date, used by Reports.
function filterPaymentsByRange(payments, from, to) {
  const ok = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  from = ok(from) ? from : "";
  to = ok(to) ? to : "";
  if (!from && !to) return payments;
  return payments.filter((p) => {
    const d = String(p.date || "").slice(0, 10);
    return d && (!from || d >= from) && (!to || d <= to);
  });
}

app.get("/api/reports", async (req, res) => {
  const data = await loadData();
  const type = req.query.type || "monthly";
  const status = req.query.status || "";
  const payments = filterPaymentsByRange(data.payments, req.query.from, req.query.to);
  res.json(buildReport(payments, type, status));
});

app.get("/api/reports/top-clients", async (req, res) => {
  const data = await loadData();
  const payments = filterPaymentsByRange(data.payments, req.query.from, req.query.to);
  const clients = buildClients(payments, data.clientIds)
    .sort((a, b) => b.totalBusiness - a.totalBusiness)
    .slice(0, 10)
    .map((c) => ({
      clientName: c.clientName,
      businessName: c.businessName,
      totalBusiness: c.totalBusiness,
      totalPending: c.totalPending
    }));
  res.json(clients);
});

/* ---------------------------------------------------------------------- */
/* Export CSV                                                             */
/* ---------------------------------------------------------------------- */

app.get("/api/export/csv", async (req, res) => {
  const data = await loadData();
  const csv = paymentsToCsv(data.payments);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="payments-export-${Date.now()}.csv"`);
  res.send(csv);
});

app.get("/api/export/expenses-csv", async (req, res) => {
  const data = await loadData();
  const csv = expensesToCsv(data.expenses);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="expenses-export-${Date.now()}.csv"`);
  res.send(csv);
});

app.get("/api/export/leads-csv", async (req, res) => {
  const data = await loadData();
  const csv = leadsToCsv(data.leads);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="leads-export-${Date.now()}.csv"`);
  res.send(csv);
});

/* ---------------------------------------------------------------------- */
/* Backup / Restore                                                       */
/* ---------------------------------------------------------------------- */

app.get("/api/backup", async (req, res) => {
  const data = await loadData();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="payflow-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

app.post("/api/restore", upload.single("backupFile"), reenterDb, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No backup file provided" });
    }
    const parsed = JSON.parse(req.file.buffer.toString("utf8"));
    const restored = {
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [...DEFAULT_DATA.categories],
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
      expenseCategories: Array.isArray(parsed.expenseCategories) ? parsed.expenseCategories : [...DEFAULT_DATA.expenseCategories],
      leads: Array.isArray(parsed.leads) ? parsed.leads : [],
      leadSources: Array.isArray(parsed.leadSources) ? parsed.leadSources : [...DEFAULT_DATA.leadSources],
      settings: {
        ...DEFAULT_DATA.settings,
        ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {})
      },
      oneTimeJobs: Array.isArray(parsed.oneTimeJobs) ? parsed.oneTimeJobs : [],
      packages: Array.isArray(parsed.packages) ? parsed.packages : [],
      clientProfiles: parsed.clientProfiles && typeof parsed.clientProfiles === "object" ? parsed.clientProfiles : {},
      clientIds: parsed.clientIds && typeof parsed.clientIds === "object" ? parsed.clientIds : {},
      calendarEvents: Array.isArray(parsed.calendarEvents) ? parsed.calendarEvents : [],
      platformOptions: Array.isArray(parsed.platformOptions) ? parsed.platformOptions : [...DEFAULT_DATA.platformOptions]
    };
    await saveData(restored);
    res.json({ success: true, message: "Backup restored successfully" });
  } catch (err) {
    res.status(500).json({ error: "Invalid backup file: " + err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Start server                                                           */
/* ---------------------------------------------------------------------- */

// Bind the HTTP port immediately, regardless of database state. This is
// what lets Render's port scanner see the service as "up" even while the
// database is unreachable, instead of the whole process exiting and
// looping (the old behavior).
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Payment Manager running on http://localhost:${PORT}`);
});

// Connect to the database in the background, retrying with backoff instead
// of killing the process on failure. dbReady gates every /api/* route via
// the middleware below, so requests get a clean 503 (not a hang or crash)
// until the connection succeeds.
let dbReady = false;
let dbLastError = null;

function connectDb(attempt = 1) {
  initDb()
    .then(() => {
      dbReady = true;
      dbLastError = null;
      console.log("Database connected.");
    })
    .catch((err) => {
      dbReady = false;
      dbLastError = err.message;
      const delay = Math.min(30000, attempt * 3000);
      console.error(
        `Database connection failed (attempt ${attempt}): ${err.message} — retrying in ${delay / 1000}s`
      );
      setTimeout(() => connectDb(attempt + 1), delay);
    });
}

// Log which host/user we're trying to reach (never the password) so a
// wrong pooler region or malformed DATABASE_URL is obvious in the logs.
try {
  const u = new URL(process.env.DATABASE_URL || "");
  console.log(`DB target -> host=${u.hostname} port=${u.port} user=${u.username}`);
} catch {
  console.error("DATABASE_URL is missing or not a valid connection string.");
}

connectDb();

// Safety net: in newer Node versions an unhandled promise rejection
// terminates the process. Several routes above don't wrap loadData()/
// saveData() in try/catch, so a DB hiccup there would previously be able
// to crash the whole server, not just that one request. Log it instead.
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection (ignored, server stays up):", err);
});