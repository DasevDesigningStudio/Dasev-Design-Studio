/* ============================================================================
   AgencyOS — Payment & Package Manager
   Backend server (Express.js) - Refactored for New Architecture
   ============================================================================ */

const express = require("express");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(express.static(__dirname));

/* ---------------------------------------------------------------------- */
/* Database Setup (Supabase Postgres)                                     */
/* ---------------------------------------------------------------------- */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const ROW_ID = "main";

// Platform Master List (Rule 3)
const PLATFORM_MASTER = ["Instagram", "Facebook", "YouTube", "LinkedIn", "Twitter/X", "Pinterest", "Other"];

const DEFAULT_DATA = {
  settings: { companyName: "AgencyOS", currency: "₹" },
  clients: [],
  payments: [],      // Central Ledger (Auto-linked)
  oneTimeJobs: [],   // TAB 2
  packages: [],      // TAB 3
};

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
}

async function loadData() {
  const { rows } = await pool.query("SELECT data FROM app_data WHERE id = $1", [ROW_ID]);
  const raw = rows[0] ? rows[0].data : {};
  return {
    ...DEFAULT_DATA,
    ...raw,
    oneTimeJobs: Array.isArray(raw.oneTimeJobs) ? raw.oneTimeJobs : [],
    packages: Array.isArray(raw.packages) ? raw.packages : [],
    payments: Array.isArray(raw.payments) ? raw.payments : [],
  };
}

async function saveData(data) {
  await pool.query("UPDATE app_data SET data = $1 WHERE id = $2", [data, ROW_ID]);
}

/* ---------------------------------------------------------------------- */
/* Helper: Auto-Flow Status (Rule 1)                                      */
/* ---------------------------------------------------------------------- */
function checkAutoCompletion(entity, type) {
  if (entity.status === "Cancelled") return entity; // Ignore cancelled ones

  if (type === "OneTime") {
    if (entity.unitsTotal > 0 && entity.unitsDone >= entity.unitsTotal) {
      entity.status = "Completed";
    }
  } else if (type === "Package") {
    if (entity.packageType === "Post & Reel") {
      const p = entity.posts.done >= entity.posts.total;
      const r = entity.reels.done >= entity.reels.total;
      const s = entity.stories.done >= entity.stories.total;
      if (p && r && s && (entity.posts.total > 0 || entity.reels.total > 0 || entity.stories.total > 0)) {
        entity.status = "Completed";
      }
    }
    // Management packages usually complete based on endDate, logic can be added here if needed
  }
  return entity;
}

/* ---------------------------------------------------------------------- */
/* Helper: Payment Auto-Link (Rule 2)                                     */
/* ---------------------------------------------------------------------- */
function syncPaymentLedger(data, entity, type) {
  const pIdx = data.payments.findIndex(p => p.sourceId === entity.id);
  const paymentStatus = entity.paidAmount >= entity.totalAmount && entity.totalAmount > 0 ? 'Paid' : (entity.paidAmount > 0 ? 'Partial' : 'Pending');
  
  const paymentRecord = {
    id: pIdx !== -1 ? data.payments[pIdx].id : `PMT-${Date.now()}`,
    sourceId: entity.id,
    sourceType: type,
    clientName: entity.clientName,
    description: entity.jobName || entity.packageName,
    category: type === "OneTime" ? entity.category : entity.packageType,
    totalAmount: entity.totalAmount,
    paidAmount: entity.paidAmount,
    pendingAmount: Math.max(0, entity.totalAmount - entity.paidAmount),
    status: paymentStatus,
    date: entity.startDate || new Date().toISOString().slice(0, 10)
  };

  if (pIdx !== -1) {
    data.payments[pIdx] = paymentRecord;
  } else {
    data.payments.push(paymentRecord);
  }
}

/* ---------------------------------------------------------------------- */
/* API Routes: ONE-TIME JOBS                                              */
/* ---------------------------------------------------------------------- */
app.get("/api/onetime", async (req, res) => {
  const data = await loadData();
  res.json(data.oneTimeJobs);
});

app.post("/api/onetime", async (req, res) => {
  try {
    const data = await loadData();
    let job = { 
      ...req.body, 
      id: `OTJ-${Date.now()}`,
      status: req.body.status || "Active" 
    };
    
    job = checkAutoCompletion(job, "OneTime");
    data.oneTimeJobs.push(job);
    syncPaymentLedger(data, job, "OneTime");
    
    await saveData(data);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/onetime/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.oneTimeJobs.findIndex(j => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Job not found" });

    let updatedJob = { ...data.oneTimeJobs[idx], ...req.body };
    updatedJob = checkAutoCompletion(updatedJob, "OneTime");
    
    data.oneTimeJobs[idx] = updatedJob;
    syncPaymentLedger(data, updatedJob, "OneTime");

    await saveData(data);
    res.json(updatedJob);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* API Routes: PACKAGES                                                   */
/* ---------------------------------------------------------------------- */
app.get("/api/packages", async (req, res) => {
  const data = await loadData();
  res.json({ packages: data.packages, platformMaster: PLATFORM_MASTER });
});

app.post("/api/packages", async (req, res) => {
  try {
    const data = await loadData();
    let pkg = { 
      ...req.body, 
      id: `PKG-${Date.now()}`,
      status: req.body.status || "Active" 
    };

    // If Management, initialize platforms with the master list if not provided
    if (pkg.packageType === "Management" && !pkg.platforms) {
      pkg.platforms = PLATFORM_MASTER.map(name => ({ name, active: false, posts: 0, reels: 0, stories: 0 }));
    }

    pkg = checkAutoCompletion(pkg, "Package");
    data.packages.push(pkg);
    syncPaymentLedger(data, pkg, "Package");

    await saveData(data);
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/packages/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });

    let updatedPkg = { ...data.packages[idx], ...req.body };
    updatedPkg = checkAutoCompletion(updatedPkg, "Package");
    
    data.packages[idx] = updatedPkg;
    syncPaymentLedger(data, updatedPkg, "Package");

    await saveData(data);
    res.json(updatedPkg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* API Routes: CENTRAL PAYMENTS & OVERVIEW (Rule 4)                       */
/* ---------------------------------------------------------------------- */
app.get("/api/payments", async (req, res) => {
  const data = await loadData();
  res.json(data.payments);
});

app.get("/api/overview", async (req, res) => {
  const data = await loadData();
  
  // Real-time rollups directly from the source arrays
  const overview = {
    oneTime: {
      total: data.oneTimeJobs.length,
      active: data.oneTimeJobs.filter(j => j.status === 'Active').length,
      completed: data.oneTimeJobs.filter(j => j.status === 'Completed').length,
      onHold: data.oneTimeJobs.filter(j => j.status === 'On Hold').length,
      paymentPending: data.oneTimeJobs.filter(j => j.totalAmount > j.paidAmount).length
    },
    packages: {
      total: data.packages.length,
      active: data.packages.filter(p => p.status === 'Active').length,
      completed: data.packages.filter(p => p.status === 'Completed').length,
      onHold: data.packages.filter(p => p.status === 'On Hold').length,
      paymentPending: data.packages.filter(p => p.totalAmount > p.paidAmount).length
    },
    lifetimeRevenue: data.payments.reduce((sum, p) => sum + (Number(p.paidAmount) || 0), 0),
    outstandingRollup: data.payments.reduce((sum, p) => sum + (Number(p.pendingAmount) || 0), 0)
  };

  res.json(overview);
});

/* ---------------------------------------------------------------------- */
/* Init & Listen                                                          */
/* ---------------------------------------------------------------------- */
initDb().then(() => {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}).catch(console.error);