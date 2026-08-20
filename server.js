/* ============================================================================
   PayFlow — Payment Manager
   Backend server (Express.js)

   DATA MODEL (v2 — flat, no Project/Deliverable layer)
   ----------------------------------------------------------------------
   CLIENT
     name, mobile, businessName, instagram, location, folderPath
     -> lifetimeRevenue / outstanding are ALWAYS derived (never stored),
        rolled up live from that client's Jobs + Packages.

     JOB (One-Time)                       PACKAGE
       jobName, category                    packageType: "Post & Reel" | "Management"
       startDate, dueDate                   name, startDate, endDate
       status: Active/In Progress/          status: Active/On Hold/
               On Hold/Completed/                   Completed/Payment Pending
               Payment Pending                totalAmount, paymentHistory[]
       progress {total, done}                 (paidAmount/pendingAmount/
       totalAmount, paymentHistory[]           paymentStatus all derived)
       (paidAmount/pendingAmount/            "Post & Reel" only:
        paymentStatus all derived)              posts/reels/stories {total, done}
                                              "Management" only:
                                                 platforms: [{name, status,
                                                   posts/reels/stories {total, done}}]

   The central "Payments" ledger is never stored on its own — it is built
   live by flattening every Job's + Package's paymentHistory[].
   ============================================================================ */

const express = require("express");
const path = require("path");
const multer = require("multer");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Static files (index.html, style.css, script.js, etc.)
app.use(express.static(__dirname));

/* ---------------------------------------------------------------------- */
/* Database (Supabase Postgres)                                          */
/* ---------------------------------------------------------------------- */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
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
}

/* ---------------------------------------------------------------------- */
/* Defaults / constants                                                  */
/* ---------------------------------------------------------------------- */

const DEFAULT_DATA = {
  clients: [],
  jobs: [],
  packages: [],
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
  platformOptions: ["Instagram", "Facebook", "YouTube", "LinkedIn", "Twitter/X", "Pinterest", "Other"]
};

const JOB_STATUSES = ["Active", "In Progress", "On Hold", "Completed", "Payment Pending"];
const PACKAGE_STATUSES = ["Active", "On Hold", "Completed", "Payment Pending"];
const PACKAGE_TYPES = ["Post & Reel", "Management"];

/* ---------------------------------------------------------------------- */
/* Load / save + one-time migration from the old v1 shape                */
/* (payments / packages+projects+deliverables / clientProfiles)          */
/* ---------------------------------------------------------------------- */

async function loadData() {
  const { rows } = await pool.query("SELECT data FROM app_data WHERE id = $1", [ROW_ID]);
  const raw = rows[0] ? rows[0].data : {};

  let data;
  const isLegacy = !Array.isArray(raw.clients) && (Array.isArray(raw.payments) || Array.isArray(raw.packages) || raw.clientProfiles);

  if (isLegacy) {
    data = migrateLegacyData(raw);
    await saveData(data);
  } else {
    data = {
      clients: Array.isArray(raw.clients) ? raw.clients : [],
      jobs: Array.isArray(raw.jobs) ? raw.jobs : [],
      packages: Array.isArray(raw.packages) ? raw.packages : [],
      categories: Array.isArray(raw.categories) ? raw.categories : [...DEFAULT_DATA.categories],
      expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
      expenseCategories: Array.isArray(raw.expenseCategories) ? raw.expenseCategories : [...DEFAULT_DATA.expenseCategories],
      leads: Array.isArray(raw.leads) ? raw.leads : [],
      leadSources: Array.isArray(raw.leadSources) ? raw.leadSources : [...DEFAULT_DATA.leadSources],
      settings: {
        ...DEFAULT_DATA.settings,
        ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {})
      },
      platformOptions: Array.isArray(raw.platformOptions) ? raw.platformOptions : [...DEFAULT_DATA.platformOptions]
    };
  }

  if (!data.expenseCategories.some((c) => c.toLowerCase() === "nasto")) {
    data.expenseCategories.push("Nasto");
    await saveData(data);
  }

  return data;
}

async function saveData(data) {
  await pool.query("UPDATE app_data SET data = $1 WHERE id = $2", [data, ROW_ID]);
}

// One-time migration: old (payments[] one-time records) + (packages[] with
// nested projects[]/deliverables[]) + (clientProfiles{} keyed by mobile) all
// collapse into the new clients[] / jobs[] / packages[] shape. The old
// Project/Deliverable layer is flattened away — every project's deliverable
// counts roll straight up onto its parent package's posts/reels/stories
// (Deliverable-type projects) or platforms (Management-type projects).
function migrateLegacyData(raw) {
  const oldPayments = Array.isArray(raw.payments) ? raw.payments : [];
  const oldPackages = Array.isArray(raw.packages) ? raw.packages : [];
  const oldProjects = Array.isArray(raw.projects) ? raw.projects : [];
  const oldDeliverables = Array.isArray(raw.deliverables) ? raw.deliverables : [];
  const oldProfiles = raw.clientProfiles && typeof raw.clientProfiles === "object" ? raw.clientProfiles : {};

  const clients = [];
  const clientIndex = new Map(); // key (mobile||name) -> client id

  function ensureClient(name, mobile, businessName, instagram) {
    const key = (mobile || name || "").toString().trim();
    if (!key) return null;
    if (clientIndex.has(key)) {
      const c = clients.find((c) => c.id === clientIndex.get(key));
      if (businessName && !c.businessName) c.businessName = businessName;
      if (instagram && !c.instagram) c.instagram = instagram;
      return c.id;
    }
    const id = nextId(clients, "CLI");
    const profile = oldProfiles[key] || oldProfiles[name] || {};
    clients.push({
      id,
      name: (name || "").toString().trim(),
      mobile: (mobile || "").toString().trim(),
      businessName: (businessName || "").toString().trim(),
      instagram: (instagram || "").toString().trim(),
      location: (profile.location || "").toString().trim(),
      folderPath: (profile.folderPath || "").toString().trim(),
      createdAt: new Date().toISOString()
    });
    clientIndex.set(key, id);
    return id;
  }

  // Old one-time payment records -> Jobs
  const jobs = oldPayments.map((p) => {
    const clientId = ensureClient(p.clientName, p.mobile, p.businessName, p.instagram);
    const totalAmount = Number(p.totalAmount) || 0;
    const paidAmount = Number(p.paidAmount) || 0;
    const paymentHistory = paidAmount > 0
      ? [{ id: `PH-${Date.now()}-${Math.floor(Math.random() * 1000)}`, date: p.date || "", amount: paidAmount, type: "Advance", note: "Migrated from previous version" }]
      : [];
    return {
      clientId,
      jobName: p.workDetails || p.category || "Job",
      category: p.category || "Other",
      startDate: p.date || new Date().toISOString().slice(0, 10),
      dueDate: p.dueDate || "",
      status: p.status === "Paid" ? "Completed" : "Active",
      progressTotal: 0,
      progressDone: 0,
      totalAmount,
      paymentHistory,
      notes: p.notes || "",
      createdAt: p.createdAt || new Date().toISOString()
    };
  });
  jobs.forEach((j, i) => { j.id = `JOB-${1001 + i}`; });

  // Old packages (+ nested projects/deliverables) -> new Packages
  const packages = oldPackages.map((pkg, pi) => {
    const clientId = ensureClient(pkg.clientName, pkg.clientMobile, "", "");
    const prjs = oldProjects.filter((pr) => pr.packageId === pkg.id);
    const hasManagement = prjs.some((pr) => pr.type === "Management");
    const packageType = hasManagement ? "Management" : "Post & Reel";

    let posts = { total: 0, done: 0 };
    let reels = { total: 0, done: 0 };
    let stories = { total: 0, done: 0 };
    let platforms = [];

    if (packageType === "Management") {
      prjs.forEach((pr) => {
        (pr.platforms || []).forEach((plat) => {
          platforms.push({
            name: plat.name || "Other",
            status: "Active",
            posts: { total: Number(plat.postsUploaded) || 0, done: Number(plat.postsUploaded) || 0 },
            reels: { total: Number(plat.reelsUploaded) || 0, done: Number(plat.reelsUploaded) || 0 },
            stories: { total: Number(plat.storiesUploaded) || 0, done: Number(plat.storiesUploaded) || 0 }
          });
        });
      });
    } else {
      const dlvs = oldDeliverables.filter((d) => prjs.some((pr) => pr.id === d.projectId));
      dlvs.forEach((d) => {
        const bucket = d.type === "Reel" ? reels : d.type === "Story" ? stories : posts;
        bucket.total += 1;
        if (d.status === "Completed") bucket.done += 1;
      });
    }

    return {
      id: `PKG-${1001 + pi}`,
      clientId,
      packageType,
      name: pkg.name || "Package",
      startDate: pkg.startDate || new Date().toISOString().slice(0, 10),
      endDate: pkg.endDate || "",
      status: pkg.status === "Cancelled" ? "On Hold" : (pkg.status || "Active"),
      totalAmount: Number(pkg.totalAmount) || 0,
      paymentHistory: Array.isArray(pkg.paymentHistory) ? pkg.paymentHistory : [],
      paymentDueDate: pkg.paymentDueDate || "",
      notes: pkg.notes || "",
      posts, reels, stories, platforms,
      createdAt: pkg.createdAt || new Date().toISOString()
    };
  });

  return {
    clients,
    jobs: jobs.map((j) => normalizeJob(j, j)),
    packages: packages.map((p) => normalizePackage(p, p)),
    categories: Array.isArray(raw.categories) ? raw.categories : [...DEFAULT_DATA.categories],
    expenses: Array.isArray(raw.expenses) ? raw.expenses : [],
    expenseCategories: Array.isArray(raw.expenseCategories) ? raw.expenseCategories : [...DEFAULT_DATA.expenseCategories],
    leads: Array.isArray(raw.leads) ? raw.leads : [],
    leadSources: Array.isArray(raw.leadSources) ? raw.leadSources : [...DEFAULT_DATA.leadSources],
    settings: {
      ...DEFAULT_DATA.settings,
      ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {})
    },
    platformOptions: Array.isArray(raw.platformOptions) ? raw.platformOptions : [...DEFAULT_DATA.platformOptions]
  };
}

/* ---------------------------------------------------------------------- */
/* ID helpers                                                             */
/* ---------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------- */
/* Shared payment-history helpers (used by both Jobs and Packages)        */
/* ---------------------------------------------------------------------- */

function normalizePaymentHistoryEntry(input, existing = {}) {
  return {
    id: existing.id || `PH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    date: input.date ?? existing.date ?? new Date().toISOString().slice(0, 10),
    amount: Number(input.amount ?? existing.amount ?? 0) || 0,
    type: (input.type ?? existing.type ?? "Advance").toString().trim() || "Advance",
    note: (input.note ?? existing.note ?? "").toString().trim()
  };
}

function computePaymentStatus(totalAmount, paidAmount) {
  const total = Number(totalAmount) || 0;
  const paid = Number(paidAmount) || 0;
  if (paid <= 0) return "Pending";
  if (paid >= total && total > 0) return "Paid";
  return "Advance";
}

/* ---------------------------------------------------------------------- */
/* Clients                                                                */
/* ---------------------------------------------------------------------- */

function normalizeClient(input, existing = {}) {
  return {
    id: existing.id,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    mobile: (input.mobile ?? existing.mobile ?? "").toString().trim(),
    businessName: (input.businessName ?? existing.businessName ?? "").toString().trim(),
    instagram: (input.instagram ?? existing.instagram ?? "").toString().trim(),
    location: (input.location ?? existing.location ?? "").toString().trim(),
    folderPath: (input.folderPath ?? existing.folderPath ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

// Lifetime revenue / outstanding are NEVER stored — always rolled up live
// from this client's jobs + packages.
function enrichClient(client, jobs, packages) {
  const cJobs = jobs.filter((j) => j.clientId === client.id);
  const cPackages = packages.filter((p) => p.clientId === client.id);

  const lifetimeRevenue =
    cJobs.reduce((s, j) => s + (Number(j.totalAmount) || 0), 0) +
    cPackages.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);

  const outstanding =
    cJobs.reduce((s, j) => s + (Number(j.pendingAmount) || 0), 0) +
    cPackages.reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0);

  const oneTime = {
    total: cJobs.length,
    active: cJobs.filter((j) => j.status === "Active" || j.status === "In Progress").length,
    onHold: cJobs.filter((j) => j.status === "On Hold").length,
    completed: cJobs.filter((j) => j.status === "Completed").length,
    paymentPending: cJobs.filter((j) => j.status === "Payment Pending").length
  };
  const pkgOverview = {
    total: cPackages.length,
    active: cPackages.filter((p) => p.status === "Active").length,
    onHold: cPackages.filter((p) => p.status === "On Hold").length,
    completed: cPackages.filter((p) => p.status === "Completed").length,
    paymentPending: cPackages.filter((p) => p.status === "Payment Pending").length
  };

  return {
    ...client,
    lifetimeRevenue,
    outstanding,
    jobs: cJobs,
    packages: cPackages,
    overview: { oneTime, packages: pkgOverview }
  };
}

/* ---------------------------------------------------------------------- */
/* Jobs (One-Time) — nested under a Client                               */
/* ---------------------------------------------------------------------- */

function normalizeJob(input, existing = {}) {
  const status = JOB_STATUSES.includes(input.status) ? input.status : (existing.status || "Active");

  const paymentHistory = Array.isArray(input.paymentHistory)
    ? input.paymentHistory.map((h) => normalizePaymentHistoryEntry(h))
    : (Array.isArray(existing.paymentHistory) ? existing.paymentHistory : []);

  const totalAmount = Number(input.totalAmount ?? existing.totalAmount ?? 0) || 0;
  const paidAmount = paymentHistory.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
  const pendingAmount = Math.max(totalAmount - paidAmount, 0);
  const paymentStatus = computePaymentStatus(totalAmount, paidAmount);

  const progressTotal = Number(input.progressTotal ?? existing.progressTotal ?? 0) || 0;
  const progressDoneRaw = Number(input.progressDone ?? existing.progressDone ?? 0) || 0;
  const progressDone = progressTotal > 0 ? Math.min(progressDoneRaw, progressTotal) : progressDoneRaw;
  const progressPending = Math.max(progressTotal - progressDone, 0);

  return {
    id: existing.id,
    clientId: input.clientId ?? existing.clientId ?? "",
    jobName: (input.jobName ?? existing.jobName ?? "").toString().trim(),
    category: (input.category ?? existing.category ?? "Other").toString().trim() || "Other",
    startDate: input.startDate ?? existing.startDate ?? new Date().toISOString().slice(0, 10),
    dueDate: input.dueDate ?? existing.dueDate ?? "",
    status,
    progressTotal,
    progressDone,
    progressPending,
    totalAmount,
    paymentHistory,
    paidAmount,
    pendingAmount,
    paymentStatus,
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

// Completed status auto-flow: whenever every progress unit is done AND the
// job isn't already Completed/On Hold/Payment Pending, it flips to
// Completed automatically — no manual drag needed.
function applyJobAutoFlow(job) {
  if (job.progressTotal > 0 && job.progressDone >= job.progressTotal &&
      job.status !== "On Hold" && job.status !== "Payment Pending") {
    job.status = "Completed";
  }
  return job;
}

/* ---------------------------------------------------------------------- */
/* Packages — nested under a Client. "Post & Reel" or "Management" type   */
/* ---------------------------------------------------------------------- */

function normalizeCounter(input, existing = {}) {
  const total = Number((input && input.total) ?? existing.total ?? 0) || 0;
  const doneRaw = Number((input && input.done) ?? existing.done ?? 0) || 0;
  const done = total > 0 ? Math.min(doneRaw, total) : doneRaw;
  return { total, done, pending: Math.max(total - done, 0) };
}

function normalizePlatformRow(input, existing = {}) {
  return {
    name: (input.name ?? existing.name ?? "Other").toString().trim() || "Other",
    status: input.status === "Inactive" || existing.status === "Inactive" ? "Inactive" : "Active",
    posts: normalizeCounter(input.posts, existing.posts || {}),
    reels: normalizeCounter(input.reels, existing.reels || {}),
    stories: normalizeCounter(input.stories, existing.stories || {})
  };
}

function normalizePackage(input, existing = {}) {
  const status = PACKAGE_STATUSES.includes(input.status) ? input.status : (existing.status || "Active");
  const packageType = PACKAGE_TYPES.includes(input.packageType) ? input.packageType : (existing.packageType || "Post & Reel");

  const paymentHistory = Array.isArray(input.paymentHistory)
    ? input.paymentHistory.map((h) => normalizePaymentHistoryEntry(h))
    : (Array.isArray(existing.paymentHistory) ? existing.paymentHistory : []);

  const totalAmount = Number(input.totalAmount ?? existing.totalAmount ?? 0) || 0;
  const paidAmount = paymentHistory.reduce((sum, h) => sum + (Number(h.amount) || 0), 0);
  const pendingAmount = Math.max(totalAmount - paidAmount, 0);
  const paymentStatus = computePaymentStatus(totalAmount, paidAmount);

  const pkg = {
    id: existing.id,
    clientId: input.clientId ?? existing.clientId ?? "",
    packageType,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    startDate: input.startDate ?? existing.startDate ?? new Date().toISOString().slice(0, 10),
    endDate: input.endDate ?? existing.endDate ?? "",
    status,
    totalAmount,
    paymentHistory,
    paidAmount,
    pendingAmount,
    paymentStatus,
    paymentDueDate: input.paymentDueDate ?? existing.paymentDueDate ?? "",
    notes: (input.notes ?? existing.notes ?? "").toString().trim(),
    createdAt: existing.createdAt || new Date().toISOString()
  };

  if (packageType === "Post & Reel") {
    pkg.posts = normalizeCounter(input.posts, existing.posts || {});
    pkg.reels = normalizeCounter(input.reels, existing.reels || {});
    pkg.stories = normalizeCounter(input.stories, existing.stories || {});
    pkg.platforms = [];
  } else {
    pkg.platforms = Array.isArray(input.platforms)
      ? input.platforms.map((row, i) => normalizePlatformRow(row, (existing.platforms || [])[i] || {}))
      : (Array.isArray(existing.platforms) ? existing.platforms : []);
    pkg.posts = { total: 0, done: 0, pending: 0 };
    pkg.reels = { total: 0, done: 0, pending: 0 };
    pkg.stories = { total: 0, done: 0, pending: 0 };
  }

  return pkg;
}

// Overall Progress % = all-done / all-total across posts+reels+stories
// (Post & Reel packages) or across every platform's counters (Management).
function computePackageProgress(pkg) {
  let total = 0;
  let done = 0;
  if (pkg.packageType === "Management") {
    (pkg.platforms || []).forEach((row) => {
      ["posts", "reels", "stories"].forEach((k) => {
        total += Number(row[k]?.total) || 0;
        done += Number(row[k]?.done) || 0;
      });
    });
  } else {
    ["posts", "reels", "stories"].forEach((k) => {
      total += Number(pkg[k]?.total) || 0;
      done += Number(pkg[k]?.done) || 0;
    });
  }
  return { total, done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
}

function enrichPackage(pkg) {
  return { ...pkg, progress: computePackageProgress(pkg) };
}

// Completed status auto-flow for packages: 100% progress -> Completed,
// unless it's deliberately On Hold or flagged Payment Pending.
function applyPackageAutoFlow(pkg) {
  const progress = computePackageProgress(pkg);
  if (progress.total > 0 && progress.done >= progress.total &&
      pkg.status !== "On Hold" && pkg.status !== "Payment Pending") {
    pkg.status = "Completed";
  }
  return pkg;
}

/* ---------------------------------------------------------------------- */
/* Central Payments ledger — derived, never stored on its own. Flattens   */
/* every Job's + every Package's paymentHistory[] into one list.          */
/* ---------------------------------------------------------------------- */

function buildPaymentsLedger(data) {
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const rows = [];

  data.jobs.forEach((job) => {
    const client = clientById.get(job.clientId);
    (job.paymentHistory || []).forEach((h) => {
      rows.push({
        entryId: h.id,
        date: h.date,
        amount: h.amount,
        type: h.type,
        note: h.note,
        source: "Job",
        sourceId: job.id,
        sourceName: job.jobName,
        clientId: job.clientId,
        clientName: client ? client.name : "",
        mobile: client ? client.mobile : ""
      });
    });
  });

  data.packages.forEach((pkg) => {
    const client = clientById.get(pkg.clientId);
    (pkg.paymentHistory || []).forEach((h) => {
      rows.push({
        entryId: h.id,
        date: h.date,
        amount: h.amount,
        type: h.type,
        note: h.note,
        source: "Package",
        sourceId: pkg.id,
        sourceName: pkg.name,
        clientId: pkg.clientId,
        clientName: client ? client.name : "",
        mobile: client ? client.mobile : ""
      });
    });
  });

  return rows.sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ---------------------------------------------------------------------- */
/* Leads (unchanged)                                                      */
/* ---------------------------------------------------------------------- */

const LEAD_STATUSES = ["New", "Contacted", "Follow-up", "Interested", "Converted", "Lost"];

function normalizeLead(input, existing = {}) {
  const status = LEAD_STATUSES.includes(input.status) ? input.status : (existing.status || "New");
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
    convertedClientId: existing.convertedClientId ?? null,
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

/* ---------------------------------------------------------------------- */
/* Expenses (unchanged)                                                   */
/* ---------------------------------------------------------------------- */

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

/* ---------------------------------------------------------------------- */
/* Dashboard / Overview / Reports — all derived from clients+jobs+packages */
/* ---------------------------------------------------------------------- */

function monthSpan(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (isNaN(start) || isNaN(end)) return null;
  let months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
  const dayAdjust = end.getDate() >= start.getDate() ? 0 : -1;
  months += dayAdjust;
  return Math.max(months, 1);
}

function availableMonthsFor(dates) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const yearMonths = Array.from({ length: 12 }, (_, i) => `${currentYear}-${String(i + 1).padStart(2, "0")}`);
  const dataMonths = Array.from(new Set(dates.map((d) => (d || "").slice(0, 7)).filter(Boolean)));
  return Array.from(new Set([...yearMonths, ...dataMonths])).sort((a, b) => b.localeCompare(a));
}

function buildDashboard(data, monthKey) {
  const ledger = buildPaymentsLedger(data);
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const availableMonths = availableMonthsFor(ledger.map((r) => r.date));

  let selectedMonth;
  if (monthKey === "all") selectedMonth = "all";
  else if (monthKey) selectedMonth = monthKey;
  else selectedMonth = currentMonthKey;

  const inScope = (d) => selectedMonth === "all" || (d || "").slice(0, 7) === selectedMonth;
  const scopedLedger = ledger.filter((r) => inScope(r.date));

  const allEntities = [...data.jobs, ...data.packages];
  const totalBusiness = allEntities.reduce((s, e) => s + (Number(e.totalAmount) || 0), 0);
  const received = ledger.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const pending = allEntities.reduce((s, e) => s + (Number(e.pendingAmount) || 0), 0);

  const clientKeys = new Set(scopedLedger.map((r) => r.clientId).filter(Boolean));
  const totalClients = clientKeys.size;

  const monthlyBusiness = ledger
    .filter((r) => (r.date || "").slice(0, 7) === currentMonthKey)
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const todayStr = now.toISOString().slice(0, 10);
  const todaysCollection = scopedLedger.filter((r) => r.date === todayStr).reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const paymentProgress = totalBusiness > 0 ? Math.round((received / totalBusiness) * 100) : 0;

  const recentPayments = [...scopedLedger].slice(0, 6);

  const upcomingDue = allEntities
    .filter((e) => (Number(e.pendingAmount) || 0) > 0 && (e.dueDate || e.paymentDueDate))
    .sort((a, b) => new Date(a.dueDate || a.paymentDueDate) - new Date(b.dueDate || b.paymentDueDate))
    .slice(0, 6)
    .map((e) => ({
      clientId: e.clientId,
      name: e.jobName || e.name,
      dueDate: e.dueDate || e.paymentDueDate,
      pendingAmount: e.pendingAmount
    }));

  const statusCounts = { Paid: 0, Advance: 0, Pending: 0 };
  allEntities.forEach((e) => {
    if (statusCounts[e.paymentStatus] !== undefined) statusCounts[e.paymentStatus] += 1;
  });

  const monthlyIncome = {};
  ledger.forEach((r) => {
    const key = (r.date || "").slice(0, 7);
    if (!key) return;
    monthlyIncome[key] = (monthlyIncome[key] || 0) + (Number(r.amount) || 0);
  });

  const categoryTotals = {};
  data.jobs.filter((j) => inScope(j.startDate)).forEach((j) => {
    categoryTotals[j.category] = (categoryTotals[j.category] || 0) + (Number(j.totalAmount) || 0);
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
    paymentProgress,
    recentPayments,
    upcomingDue,
    statusCounts,
    monthlyIncome,
    categoryTotals
  };
}

function buildOverview(data, monthKey) {
  const clients = data.clients;
  const jobs = data.jobs;
  const packages = data.packages;
  const ledger = buildPaymentsLedger(data);

  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const todayStr = now.toISOString().slice(0, 10);

  const availableMonths = availableMonthsFor([
    ...ledger.map((r) => r.date),
    ...jobs.map((j) => j.startDate),
    ...packages.map((p) => p.startDate)
  ]);

  let selectedMonth;
  if (monthKey === "all") selectedMonth = "all";
  else if (monthKey) selectedMonth = monthKey;
  else selectedMonth = currentMonthKey;

  const inScope = (d) => selectedMonth === "all" || (d || "").slice(0, 7) === selectedMonth;

  /* ---- Clients (union across One-Time Jobs + Packages) ---- */
  const oneTimeClientIds = new Set(jobs.map((j) => j.clientId).filter(Boolean));
  const packageClientIds = new Set(packages.map((p) => p.clientId).filter(Boolean));
  const allClientIds = new Set([...oneTimeClientIds, ...packageClientIds]);
  const oneTimeOnlyIds = new Set([...oneTimeClientIds].filter((k) => !packageClientIds.has(k)));

  const firstSeen = new Map();
  jobs.forEach((j) => {
    if (!j.clientId) return;
    const d = j.startDate || (j.createdAt || "").slice(0, 10);
    if (!firstSeen.has(j.clientId) || d < firstSeen.get(j.clientId)) firstSeen.set(j.clientId, d);
  });
  packages.forEach((p) => {
    if (!p.clientId) return;
    const d = p.startDate || (p.createdAt || "").slice(0, 10);
    if (!firstSeen.has(p.clientId) || d < firstSeen.get(p.clientId)) firstSeen.set(p.clientId, d);
  });
  const newClientsThisMonth = Array.from(firstSeen.values()).filter((d) => (d || "").slice(0, 7) === currentMonthKey).length;

  /* ---- Income split (One-Time vs Package), scoped ---- */
  const scopedLedger = ledger.filter((r) => inScope(r.date));
  const oneTimeIncome = scopedLedger.filter((r) => r.source === "Job").reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const packageIncome = scopedLedger.filter((r) => r.source === "Package").reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const mrr = packages
    .filter((pkg) => pkg.status === "Active")
    .reduce((sum, pkg) => {
      const span = monthSpan(pkg.startDate, pkg.endDate);
      if (!span) return sum;
      return sum + (Number(pkg.totalAmount) || 0) / span;
    }, 0);

  const totalBusinessValue =
    jobs.reduce((s, j) => s + (Number(j.totalAmount) || 0), 0) +
    packages.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);

  const oneTimeAllTime = jobs.reduce((s, j) => s + (Number(j.totalAmount) || 0), 0);
  const packageAllTime = packages.reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
  const avgRevPerOneTimeClient = oneTimeClientIds.size ? oneTimeAllTime / oneTimeClientIds.size : 0;
  const avgRevPerPackageClient = packageClientIds.size ? packageAllTime / packageClientIds.size : 0;

  /* ---- Completion status ---- */
  const totalJobs = jobs.length;
  const jobsCompleted = jobs.filter((j) => j.status === "Completed").length;
  const jobsPaymentPending = jobs.filter((j) => j.status === "Payment Pending").length;
  const jobsOnHold = jobs.filter((j) => j.status === "On Hold").length;
  const jobsActive = totalJobs - jobsCompleted - jobsPaymentPending - jobsOnHold;

  const packagesCompleted = packages.filter((p) => p.status === "Completed").length;
  const packagesPaymentPending = packages.filter((p) => p.status === "Payment Pending").length;
  const packagesOnHold = packages.filter((p) => p.status === "On Hold").length;
  const packagesRunning = packages.filter((p) => p.status === "Active").length;

  /* ---- Package duration breakdown ---- */
  const durationBuckets = new Map();
  packages.forEach((pkg) => {
    const span = monthSpan(pkg.startDate, pkg.endDate);
    if (!span) return;
    durationBuckets.set(span, (durationBuckets.get(span) || 0) + 1);
  });
  const packageDuration = Array.from(durationBuckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([months, count]) => ({ label: months === 1 ? "1 Month" : `${months} Months`, months, count }));
  const maxDurationCount = packageDuration.reduce((m, d) => Math.max(m, d.count), 0);

  /* ---- One-Time -> Package upsell funnel ---- */
  const convertedIds = new Set([...oneTimeClientIds].filter((k) => packageClientIds.has(k)));
  const upsellPct = oneTimeClientIds.size ? Math.round((convertedIds.size / oneTimeClientIds.size) * 100) : 0;

  const packageCountByClient = new Map();
  packages.forEach((pkg) => {
    if (!pkg.clientId) return;
    packageCountByClient.set(pkg.clientId, (packageCountByClient.get(pkg.clientId) || 0) + 1);
  });
  const repeatClients = Array.from(packageCountByClient.values()).filter((n) => n >= 2).length;
  const repeatPackagePct = packageClientIds.size ? Math.round((repeatClients / packageClientIds.size) * 100) : 0;

  /* ---- Income by service (job category), scoped ---- */
  const categoryTotals = {};
  jobs.filter((j) => inScope(j.startDate)).forEach((j) => {
    categoryTotals[j.category] = (categoryTotals[j.category] || 0) + (Number(j.totalAmount) || 0);
  });
  const categorySum = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
  const incomeByService = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => ({ category, amount, percent: categorySum > 0 ? Math.round((amount / categorySum) * 100) : 0 }));

  /* ---- Business health signals ---- */
  const overduePayments =
    jobs.filter((j) => (Number(j.pendingAmount) || 0) > 0 && j.dueDate && j.dueDate < todayStr).length +
    packages.filter((p) => (Number(p.pendingAmount) || 0) > 0 && p.paymentDueDate && p.paymentDueDate < todayStr).length;

  const packagesEndingThisMonth = packages.filter(
    (p) => p.status === "Active" && p.endDate && p.endDate.slice(0, 7) === currentMonthKey
  ).length;

  const expectedCollection =
    jobs.filter((j) => (Number(j.pendingAmount) || 0) > 0 && j.dueDate && j.dueDate.slice(0, 7) === currentMonthKey)
      .reduce((s, j) => s + (Number(j.pendingAmount) || 0), 0) +
    packages.filter((p) => (Number(p.pendingAmount) || 0) > 0 && p.paymentDueDate && p.paymentDueDate.slice(0, 7) === currentMonthKey)
      .reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0);

  const totalOutstanding =
    jobs.reduce((s, j) => s + (Number(j.pendingAmount) || 0), 0) +
    packages.reduce((s, p) => s + (Number(p.pendingAmount) || 0), 0);

  const followupsToday = data.leads.filter(
    (l) => l.nextFollowupDate === todayStr && l.status !== "Converted" && l.status !== "Lost"
  ).length;

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const newLeadsThisWeek = data.leads.filter((l) => l.createdAt && new Date(l.createdAt) >= weekAgo).length;

  return {
    selectedMonth,
    availableMonths,
    clients: {
      total: allClientIds.size,
      oneTimeOnly: oneTimeOnlyIds.size,
      package: packageClientIds.size,
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
      jobsActive,
      jobsOnHold,
      jobsCompleted,
      jobsPaymentPending,
      packagesTotal: packages.length,
      packagesRunning,
      packagesOnHold,
      packagesCompleted,
      packagesPaymentPending
    },
    packageDuration,
    maxDurationCount,
    upsell: {
      oneTimeClients: oneTimeClientIds.size,
      convertedClients: convertedIds.size,
      conversionPercent: upsellPct,
      packageClients: packageClientIds.size,
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

function groupKey(row, type) {
  const date = row.date ? new Date(row.date) : null;
  switch (type) {
    case "daily":
      return row.date || "Unknown";
    case "weekly": {
      if (!date || isNaN(date)) return "Unknown";
      const firstDay = new Date(date);
      const day = firstDay.getDay();
      const diff = firstDay.getDate() - day + (day === 0 ? -6 : 1);
      firstDay.setDate(diff);
      return firstDay.toISOString().slice(0, 10);
    }
    case "monthly":
      return (row.date || "").slice(0, 7) || "Unknown";
    case "yearly":
      return (row.date || "").slice(0, 4) || "Unknown";
    case "client":
      return row.clientName || "Unknown";
    default:
      return (row.date || "").slice(0, 7) || "Unknown";
  }
}

function buildReport(ledger, type) {
  const map = new Map();
  ledger.forEach((r) => {
    const key = groupKey(r, type);
    if (!map.has(key)) map.set(key, { key, count: 0, amount: 0 });
    const g = map.get(key);
    g.count += 1;
    g.amount += Number(r.amount) || 0;
  });
  return Array.from(map.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

function buildTopClients(data) {
  return data.clients
    .map((c) => enrichClient(c, data.jobs, data.packages))
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue)
    .slice(0, 10)
    .map((c) => ({ id: c.id, name: c.name, businessName: c.businessName, lifetimeRevenue: c.lifetimeRevenue, outstanding: c.outstanding }));
}

/* ---------------------------------------------------------------------- */
/* CSV export helpers                                                    */
/* ---------------------------------------------------------------------- */

function csvEscape(val) {
  const str = String(val ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function jobsToCsv(jobs, clientById) {
  const headers = ["ID", "Client", "Mobile", "Job Name", "Category", "Start Date", "Due Date", "Status", "Total", "Paid", "Pending", "Payment Status", "Notes"];
  const rows = jobs.map((j) => {
    const c = clientById.get(j.clientId) || {};
    return [j.id, c.name, c.mobile, j.jobName, j.category, j.startDate, j.dueDate, j.status, j.totalAmount, j.paidAmount, j.pendingAmount, j.paymentStatus, j.notes];
  });
  return [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function packagesToCsv(packages, clientById) {
  const headers = ["ID", "Client", "Mobile", "Type", "Name", "Start Date", "End Date", "Status", "Total", "Paid", "Pending", "Payment Status", "Progress %"];
  const rows = packages.map((p) => {
    const c = clientById.get(p.clientId) || {};
    const progress = computePackageProgress(p);
    return [p.id, c.name, c.mobile, p.packageType, p.name, p.startDate, p.endDate, p.status, p.totalAmount, p.paidAmount, p.pendingAmount, p.paymentStatus, progress.percent];
  });
  return [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function expensesToCsv(expenses) {
  const headers = ["ID", "Date", "Category", "Amount", "Notes"];
  const rows = expenses.map((e) => [e.id, e.date, e.category, e.amount, e.notes]);
  return [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
}

function leadsToCsv(leads) {
  const headers = ["ID", "Name", "Mobile", "Business", "Instagram", "Source", "Status", "Expected Value", "Next Follow-up", "Notes", "Created"];
  const rows = leads.map((l) => [l.id, l.name, l.mobile, l.businessName, l.instagram, l.source, l.status, l.expectedValue, l.nextFollowupDate, l.notes, l.createdAt]);
  return [headers.join(","), ...rows.map((row) => row.map(csvEscape).join(","))].join("\n");
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

/* ---------------------------------------------------------------------- */
/* Clients                                                                */
/* ---------------------------------------------------------------------- */

app.get("/api/clients", async (req, res) => {
  const data = await loadData();
  const list = data.clients
    .map((c) => enrichClient(c, data.jobs, data.packages))
    .sort((a, b) => b.lifetimeRevenue - a.lifetimeRevenue);
  res.json(list);
});

app.get("/api/clients/:id", async (req, res) => {
  const data = await loadData();
  const client = data.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  res.json(enrichClient(client, data.jobs, data.packages));
});

app.post("/api/clients", async (req, res) => {
  try {
    const data = await loadData();
    const client = normalizeClient(req.body, {});
    client.id = nextId(data.clients, "CLI");
    data.clients.push(client);
    await saveData(data);
    res.json(enrichClient(client, data.jobs, data.packages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/clients/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.clients.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Client not found" });
    const updated = normalizeClient(req.body, data.clients[idx]);
    updated.id = data.clients[idx].id;
    data.clients[idx] = updated;
    await saveData(data);
    res.json(enrichClient(updated, data.jobs, data.packages));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/clients/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.clients.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Client not found" });
    data.jobs = data.jobs.filter((j) => j.clientId !== req.params.id);
    data.packages = data.packages.filter((p) => p.clientId !== req.params.id);
    data.clients.splice(idx, 1);
    await saveData(data);
    res.json({ success: true, message: "Client (and their jobs/packages) deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Jobs (One-Time) — nested under a Client                               */
/* ---------------------------------------------------------------------- */

app.get("/api/jobs", async (req, res) => {
  const data = await loadData();
  const list = data.jobs.filter((j) => !req.query.clientId || j.clientId === req.query.clientId);
  res.json(list);
});

app.post("/api/jobs", async (req, res) => {
  try {
    const data = await loadData();
    if (!req.body.clientId || !data.clients.some((c) => c.id === req.body.clientId)) {
      return res.status(400).json({ error: "A valid clientId is required" });
    }
    const job = applyJobAutoFlow(normalizeJob(req.body, {}));
    job.id = nextId(data.jobs, "JOB");
    job.createdAt = new Date().toISOString();
    data.jobs.push(job);
    await saveData(data);
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/jobs/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.jobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Job not found" });
    const updated = applyJobAutoFlow(normalizeJob(req.body, data.jobs[idx]));
    updated.id = data.jobs[idx].id;
    data.jobs[idx] = updated;
    await saveData(data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/jobs/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.jobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Job not found" });
    data.jobs.splice(idx, 1);
    await saveData(data);
    res.json({ success: true, message: "Job deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a payment entry -> automatically shows up in the central Payments tab.
app.post("/api/jobs/:id/payments", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.jobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Job not found" });
    const entry = normalizePaymentHistoryEntry(req.body, {});
    const job = data.jobs[idx];
    job.paymentHistory = [...(job.paymentHistory || []), entry];
    data.jobs[idx] = applyJobAutoFlow(normalizeJob(job, job));
    await saveData(data);
    res.json(data.jobs[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/jobs/:id/payments/:entryId", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.jobs.findIndex((j) => j.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Job not found" });
    const job = data.jobs[idx];
    job.paymentHistory = (job.paymentHistory || []).filter((h) => h.id !== req.params.entryId);
    data.jobs[idx] = normalizeJob(job, job);
    await saveData(data);
    res.json(data.jobs[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Packages — nested under a Client. Post & Reel / Management             */
/* ---------------------------------------------------------------------- */

app.get("/api/packages", async (req, res) => {
  const data = await loadData();
  const list = data.packages
    .filter((p) => !req.query.clientId || p.clientId === req.query.clientId)
    .map(enrichPackage);
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
    if (!req.body.clientId || !data.clients.some((c) => c.id === req.body.clientId)) {
      return res.status(400).json({ error: "A valid clientId is required" });
    }
    const pkg = applyPackageAutoFlow(normalizePackage(req.body, {}));
    pkg.id = nextId(data.packages, "PKG");
    pkg.createdAt = new Date().toISOString();
    data.packages.push(pkg);
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
    const updated = applyPackageAutoFlow(normalizePackage(req.body, data.packages[idx]));
    updated.id = data.packages[idx].id;
    data.packages[idx] = updated;
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
    await saveData(data);
    res.json({ success: true, message: "Package deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/packages/:id/payments", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const entry = normalizePaymentHistoryEntry(req.body, {});
    const pkg = data.packages[idx];
    pkg.paymentHistory = [...(pkg.paymentHistory || []), entry];
    data.packages[idx] = normalizePackage(pkg, pkg);
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
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add a platform row to a Management-type package (select-to-add from the
// fixed master platformOptions list).
app.post("/api/packages/:id/platforms", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    if (pkg.packageType !== "Management") return res.status(400).json({ error: "Platforms only apply to Management packages" });
    if ((pkg.platforms || []).some((p) => p.name === req.body.name)) {
      return res.status(400).json({ error: "Platform already added" });
    }
    pkg.platforms = [...(pkg.platforms || []), normalizePlatformRow(req.body, {})];
    data.packages[idx] = applyPackageAutoFlow(normalizePackage(pkg, pkg));
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/packages/:id/platforms/:name", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    const pIdx = (pkg.platforms || []).findIndex((p) => p.name === decodeURIComponent(req.params.name));
    if (pIdx === -1) return res.status(404).json({ error: "Platform not found on this package" });
    pkg.platforms[pIdx] = normalizePlatformRow(req.body, pkg.platforms[pIdx]);
    data.packages[idx] = applyPackageAutoFlow(normalizePackage(pkg, pkg));
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/packages/:id/platforms/:name", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const pkg = data.packages[idx];
    pkg.platforms = (pkg.platforms || []).filter((p) => p.name !== decodeURIComponent(req.params.name));
    data.packages[idx] = normalizePackage(pkg, pkg);
    await saveData(data);
    res.json(enrichPackage(data.packages[idx]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Central Payments ledger (derived, read-only + convenience delete)      */
/* ---------------------------------------------------------------------- */

app.get("/api/payments", async (req, res) => {
  const data = await loadData();
  let ledger = buildPaymentsLedger(data);
  if (req.query.clientId) ledger = ledger.filter((r) => r.clientId === req.query.clientId);
  res.json(ledger);
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
    lead.id = nextId(data.leads, "LED");
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
    if (idx === -1) return res.status(404).json({ error: "Lead not found" });
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
    if (idx === -1) return res.status(404).json({ error: "Lead not found" });
    data.leads.splice(idx, 1);
    await saveData(data);
    res.json({ success: true, message: "Lead deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convert a lead -> creates (or reuses) a Client, then a starter One-Time Job.
app.post("/api/leads/:id/convert", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.leads.findIndex((l) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Lead not found" });
    const lead = data.leads[idx];

    let client = data.clients.find((c) => (c.mobile && c.mobile === lead.mobile) || (!lead.mobile && c.name === lead.name));
    if (!client) {
      client = normalizeClient({ name: lead.name, mobile: lead.mobile, businessName: lead.businessName, instagram: lead.instagram }, {});
      client.id = nextId(data.clients, "CLI");
      data.clients.push(client);
    }

    const job = applyJobAutoFlow(normalizeJob({
      clientId: client.id,
      jobName: req.body.jobName || "New Job",
      category: req.body.category || "Other",
      startDate: req.body.date || new Date().toISOString().slice(0, 10),
      dueDate: req.body.dueDate || "",
      totalAmount: req.body.totalAmount ?? lead.expectedValue,
      notes: lead.notes
    }, {}));
    job.id = nextId(data.jobs, "JOB");
    job.createdAt = new Date().toISOString();
    data.jobs.push(job);

    lead.status = "Converted";
    lead.convertedClientId = client.id;
    data.leads[idx] = lead;

    await saveData(data);
    res.json({ lead, client, job });
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
    if (!name) return res.status(400).json({ error: "Source name is required" });
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
/* Categories / Platform options                                          */
/* ---------------------------------------------------------------------- */

app.get("/api/categories", async (req, res) => {
  const data = await loadData();
  res.json(data.categories);
});

app.post("/api/categories", async (req, res) => {
  try {
    const data = await loadData();
    const name = (req.body.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "Category name is required" });
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
    if (idx === -1) return res.status(404).json({ error: "Category not found" });
    data.categories.splice(idx, 1);
    await saveData(data);
    res.json(data.categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/platform-options", async (req, res) => {
  const data = await loadData();
  res.json(data.platformOptions);
});

app.post("/api/platform-options", async (req, res) => {
  try {
    const data = await loadData();
    const name = (req.body.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "Platform name is required" });
    if (data.platformOptions.some((p) => p.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: "Platform already exists" });
    }
    data.platformOptions.push(name);
    await saveData(data);
    res.json(data.platformOptions);
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
    expense.id = nextId(data.expenses, "EXP");
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
    if (idx === -1) return res.status(404).json({ error: "Expense not found" });
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
    if (idx === -1) return res.status(404).json({ error: "Expense not found" });
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
    if (!name) return res.status(400).json({ error: "Category name is required" });
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
/* Dashboard / Overview / Reports                                        */
/* ---------------------------------------------------------------------- */

app.get("/api/dashboard", async (req, res) => {
  const data = await loadData();
  res.json(buildDashboard(data, req.query.month));
});

app.get("/api/overview", async (req, res) => {
  const data = await loadData();
  res.json(buildOverview(data, req.query.month));
});

app.get("/api/reports", async (req, res) => {
  const data = await loadData();
  const ledger = buildPaymentsLedger(data);
  res.json(buildReport(ledger, req.query.type || "monthly"));
});

app.get("/api/reports/top-clients", async (req, res) => {
  const data = await loadData();
  res.json(buildTopClients(data));
});

/* ---------------------------------------------------------------------- */
/* Export CSV                                                             */
/* ---------------------------------------------------------------------- */

app.get("/api/export/csv", async (req, res) => {
  const data = await loadData();
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const csv = jobsToCsv(data.jobs, clientById);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="jobs-export-${Date.now()}.csv"`);
  res.send(csv);
});

app.get("/api/export/packages-csv", async (req, res) => {
  const data = await loadData();
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const csv = packagesToCsv(data.packages, clientById);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="packages-export-${Date.now()}.csv"`);
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

app.post("/api/restore", upload.single("backupFile"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No backup file provided" });
    const parsed = JSON.parse(req.file.buffer.toString("utf8"));
    const restored = Array.isArray(parsed.clients)
      ? {
          clients: parsed.clients,
          jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
          packages: Array.isArray(parsed.packages) ? parsed.packages : [],
          categories: Array.isArray(parsed.categories) ? parsed.categories : [...DEFAULT_DATA.categories],
          expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
          expenseCategories: Array.isArray(parsed.expenseCategories) ? parsed.expenseCategories : [...DEFAULT_DATA.expenseCategories],
          leads: Array.isArray(parsed.leads) ? parsed.leads : [],
          leadSources: Array.isArray(parsed.leadSources) ? parsed.leadSources : [...DEFAULT_DATA.leadSources],
          settings: { ...DEFAULT_DATA.settings, ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {}) },
          platformOptions: Array.isArray(parsed.platformOptions) ? parsed.platformOptions : [...DEFAULT_DATA.platformOptions]
        }
      : migrateLegacyData(parsed); // old-shape backup file -> migrate on restore too
    await saveData(restored);
    res.json({ success: true, message: "Backup restored successfully" });
  } catch (err) {
    res.status(500).json({ error: "Invalid backup file: " + err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Start server                                                           */
/* ---------------------------------------------------------------------- */

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Payment Manager running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to connect to database:", err.message);
    process.exit(1);
  });
