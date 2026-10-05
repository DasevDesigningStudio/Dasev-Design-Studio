/* Team member add karva mate (Step B ma Team page aave tya sudhi).
   Usage:
     DATABASE_URL="postgresql://..." node add-user.js email "Naam" role "TempPassword"
   Role: manager | sales | finance | editor | designer | shooter | sm | viewer
   Member e pehli login par potano password badalvo padse. */
const crypto = require("crypto");
const { Pool } = require("pg");

const [email, name, role, password] = process.argv.slice(2);
const ROLES = ["manager", "sales", "finance", "editor", "designer", "shooter", "sm", "viewer"];

if (!process.env.DATABASE_URL || !email || !name || !role || !password) {
  console.error('Usage: DATABASE_URL="..." node add-user.js email "Naam" role "TempPassword"');
  process.exit(1);
}
if (!ROLES.includes(role)) { console.error("Role khotu. Vaparo: " + ROLES.join(", ")); process.exit(1); }
if (password.length < 8) { console.error("Password kam ma kam 8 akshar no."); process.exit(1); }

const salt = crypto.randomBytes(16);
const hash = `scrypt$${salt.toString("hex")}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

pool.query(
  "INSERT INTO users (email, name, role, password_hash, must_change_password) VALUES ($1,$2,$3,$4,TRUE)",
  [email.trim().toLowerCase(), name.trim(), role, hash]
).then(() => console.log(`✅ ${name} (${role}) add thayo. Temp password aapo, pehli login par e badlase.`))
  .catch((e) => console.error(/duplicate/.test(e.message) ? "Aa email pehla thi che." : e.message))
  .finally(() => pool.end());
