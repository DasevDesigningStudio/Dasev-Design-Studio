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
app.use(express.static(__dirname));

/* ---------------------------------------------------------------------- */
/* Database (Supabase Postgres) — replaces the old data.json file so data */
/* survives restarts / free-tier spin-downs.                              */
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
  platformOptions: ["Instagram", "Facebook", "YouTube", "LinkedIn", "Twitter/X", "Pinterest", "Other"]
};

async function loadData() {
  const { rows } = await pool.query("SELECT data FROM app_data WHERE id = $1", [ROW_ID]);
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
    platformOptions: Array.isArray(raw.platformOptions) ? raw.platformOptions : [...DEFAULT_DATA.platformOptions]
  };

  // One-time migration: make sure the "Nasto" expense category exists on
  // data that was created before it was added to the defaults.
  if (!data.expenseCategories.some((c) => c.toLowerCase() === "nasto")) {
    data.expenseCategories.push("Nasto");
    await saveData(data);
  }

  return data;
}

async function saveData(data) {
  await pool.query("UPDATE app_data SET data = $1 WHERE id = $2", [data, ROW_ID]);
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
const PACKAGE_STATUSES = ["Active", "On Hold", "Completed"];
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

function clientProfileKey(mobile, clientName) {
  return (mobile || clientName || "").toString().trim();
}

function normalizePaymentHistoryEntry(input, existing = {}) {
  return {
    id: existing.id || `PH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    date: input.date ?? existing.date ?? new Date().toISOString().slice(0, 10),
    amount: Number(input.amount ?? existing.amount ?? 0) || 0,
    type: (input.type ?? existing.type ?? "Advance").toString().trim() || "Advance",
    note: (input.note ?? existing.note ?? "").toString().trim()
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
    createdAt: existing.createdAt || new Date().toISOString()
  };

  if (type === "Management") {
    const platforms = Array.isArray(input.platforms)
      ? input.platforms.map(normalizePlatformRow)
      : (Array.isArray(existing.platforms) ? existing.platforms : []);
    return { ...base, platforms };
  }

  // PostReel type
  return {
    ...base,
    posts: normalizeCounterPair(input.posts ?? existing.posts),
    reels: normalizeCounterPair(input.reels ?? existing.reels),
    stories: normalizeCounterPair(input.stories ?? existing.stories)
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
  const posts = pkg.posts || { total: 0, done: 0 };
  const reels = pkg.reels || { total: 0, done: 0 };
  const stories = pkg.stories || { total: 0, done: 0 };
  const total = posts.total + reels.total + stories.total;
  const done = posts.done + reels.done + stories.done;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return { type: "PostReel", total, done, pending: Math.max(total - done, 0), percent };
}

function enrichPackage(pkg) {
  return { ...pkg, progress: computePackageProgress(pkg) };
}


/* ---------------------------------------------------------------------- */
/* Derived data builders                                                  */
/* ---------------------------------------------------------------------- */

function buildClients(payments) {
  const map = new Map();
  payments.forEach((p) => {
    const key = p.mobile || p.clientName;
    if (!map.has(key)) {
      map.set(key, {
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
    // Keep most recent business/instagram info
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

  const clientKeys = new Set(scoped.map((p) => p.mobile || p.clientName));
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
  return (p.mobile || p.clientName || "").toString().trim();
}
function clientKeyOfPackage(pkg) {
  return (pkg.clientMobile || pkg.clientName || "").toString().trim();
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
  res.json(buildClients(payments));
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

app.get("/api/client-profiles", async (req, res) => {
  const data = await loadData();
  res.json(data.clientProfiles);
});

app.put("/api/client-profiles/:key", async (req, res) => {
  try {
    const data = await loadData();
    const key = decodeURIComponent(req.params.key);
    if (!key) return res.status(400).json({ error: "Client key is required" });
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
  return entity.clientMobile === clientKey || entity.clientName === clientKey;
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

app.post("/api/packages/:id/payments", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.packages.findIndex((p) => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Package not found" });
    const entry = normalizePaymentHistoryEntry(req.body, {});
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
    oneTime: countBy(jobs, ["Active", "In Progress", "On Hold", "Completed"]),
    packages: countBy(pkgs, ["Active", "On Hold", "Completed"])
  });
});


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

app.get("/api/reports", async (req, res) => {
  const data = await loadData();
  const type = req.query.type || "monthly";
  const status = req.query.status || "";
  res.json(buildReport(data.payments, type, status));
});

app.get("/api/reports/top-clients", async (req, res) => {
  const data = await loadData();
  const clients = buildClients(data.payments)
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

app.post("/api/restore", upload.single("backupFile"), async (req, res) => {
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