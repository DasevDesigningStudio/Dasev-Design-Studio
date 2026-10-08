/* ============================================================================
   One-time migration: pushes your existing data.json into Supabase.
   Run this ONCE after you've set DATABASE_URL and deployed the new server.js.

   Usage (locally, with DATABASE_URL set in your environment):
     DATABASE_URL="postgresql://..." node migrate-to-supabase.js
   ============================================================================ */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const DATA_FILE = path.join(__dirname, "data.json");
const ROW_ID = "main";

if (!process.env.DATABASE_URL) {
  console.error("ERROR: Set DATABASE_URL env variable first (your Supabase connection string).");
  process.exit(1);
}

if (!fs.existsSync(DATA_FILE)) {
  console.error(`ERROR: ${DATA_FILE} not found.`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

const data = {
  payments: Array.isArray(raw.payments) ? raw.payments : [],
  categories: Array.isArray(raw.categories) ? raw.categories : ["Post", "Reel", "Video", "Design", "Ads", "Management", "Other"],
  expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
  expenseCategories: Array.isArray(raw.expenseCategories) ? raw.expenseCategories : ["Ad Spend", "Software/Tools", "Salary", "Freelancer", "Rent", "Internet/Phone", "Travel", "Nasto", "Other"],
  leads: Array.isArray(raw.leads) ? raw.leads : [],
  leadSources: Array.isArray(raw.leadSources) ? raw.leadSources : ["Instagram DM", "Referral", "Cold Call", "Website", "Other"],
  settings: {
    companyName: "My Agency",
    currency: "₹",
    themeColor: "teal",
    darkMode: false,
    ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {})
  }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_data (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      )
    `);

    const { rows } = await pool.query("SELECT 1 FROM app_data WHERE id = $1", [ROW_ID]);
    if (rows.length === 0) {
      await pool.query("INSERT INTO app_data (id, data) VALUES ($1, $2)", [ROW_ID, data]);
      console.log(`✅ Inserted ${data.payments.length} payments and ${data.expenses.length} expenses into Supabase.`);
    } else {
      await pool.query("UPDATE app_data SET data = $1 WHERE id = $2", [data, ROW_ID]);
      console.log(`✅ Updated Supabase with ${data.payments.length} payments and ${data.expenses.length} expenses.`);
    }
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
