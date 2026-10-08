const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const file = path.join(__dirname, 'migration', 'content-production.json');
  const incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    const { rows } = await pool.query('SELECT data FROM app_data WHERE id = $1', ['main']);
    if (!rows[0]) throw new Error('app_data/main not found. Start the app once first.');
    const data = rows[0].data || {};
    data.contentProduction = Array.isArray(data.contentProduction) ? data.contentProduction : [];
    const ids = new Set(data.contentProduction.map(x => x.id));
    let added = 0;
    for (const item of incoming) {
      if (!ids.has(item.id)) { data.contentProduction.push(item); ids.add(item.id); added++; }
    }
    await pool.query('UPDATE app_data SET data = $1 WHERE id = $2', [data, 'main']);
    console.log(`Content Production migration complete. Added ${added} of ${incoming.length} old records.`);
  } finally { await pool.end(); }
}
main().catch(err => { console.error(err); process.exit(1); });
