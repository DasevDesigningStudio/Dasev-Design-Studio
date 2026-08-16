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
  crmClients: [],
  settings: {
    companyName: "My Agency",
    currency: "₹",
    themeColor: "teal",
    darkMode: false
  }
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
    crmClients: Array.isArray(raw.crmClients) ? raw.crmClients : [],
    settings: {
      ...DEFAULT_DATA.settings,
      ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {})
    }
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
/* CRM: Clients -> Projects -> Packages -> (Platforms | Deliverables)     */
/* ---------------------------------------------------------------------- */

function genId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function normalizeCrmClient(input, existing = {}) {
  return {
    id: existing.id,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    mobile: (input.mobile ?? existing.mobile ?? "").toString().trim(),
    business: (input.business ?? existing.business ?? "").toString().trim(),
    instagram: (input.instagram ?? existing.instagram ?? "").toString().trim(),
    location: (input.location ?? existing.location ?? "").toString().trim(),
    folderPath: (input.folderPath ?? existing.folderPath ?? "").toString().trim(),
    projects: existing.projects || [],
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function normalizeProject(input, existing = {}) {
  return {
    id: existing.id,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    startDate: input.startDate ?? existing.startDate ?? "",
    endDate: input.endDate ?? existing.endDate ?? "",
    status: input.status ?? existing.status ?? "Active",
    priority: input.priority ?? existing.priority ?? "Medium",
    packages: existing.packages || [],
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function normalizePackagePayment(input, existing = {}) {
  const total = Number(input.total ?? existing.total ?? 0) || 0;
  const paid = Number(input.paid ?? existing.paid ?? 0) || 0;
  const pending = Math.max(total - paid, 0);
  return {
    total,
    paid,
    pending,
    status: computeStatus(total, paid),
    dueDate: input.dueDate ?? existing.dueDate ?? "",
    history: existing.history || []
  };
}

function normalizePackage(input, existing = {}) {
  const type = ["Deliverable", "Management"].includes(input.type) ? input.type : (existing.type || "Deliverable");
  return {
    id: existing.id,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    type,
    startDate: input.startDate ?? existing.startDate ?? "",
    endDate: input.endDate ?? existing.endDate ?? "",
    payment: existing.payment || normalizePackagePayment({}, {}),
    platforms: existing.platforms || [],
    deliverables: existing.deliverables || [],
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

function normalizePlatform(input, existing = {}) {
  return {
    id: existing.id,
    name: (input.name ?? existing.name ?? "").toString().trim(),
    posts: Number(input.posts ?? existing.posts ?? 0) || 0,
    reels: Number(input.reels ?? existing.reels ?? 0) || 0,
    stories: Number(input.stories ?? existing.stories ?? 0) || 0
  };
}

const DELIVERABLE_STATUSES = ["Pending", "In Progress", "Review", "Completed"];

function normalizeDeliverable(input, existing = {}) {
  const status = DELIVERABLE_STATUSES.includes(input.status) ? input.status : (existing.status || "Pending");
  return {
    id: existing.id,
    type: (input.type ?? existing.type ?? "Post").toString().trim(),
    startDate: input.startDate ?? existing.startDate ?? "",
    dueDate: input.dueDate ?? existing.dueDate ?? "",
    completedDate: input.completedDate ?? existing.completedDate ?? "",
    status,
    platform: (input.platform ?? existing.platform ?? "").toString().trim(),
    publishDate: input.publishDate ?? existing.publishDate ?? "",
    url: (input.url ?? existing.url ?? "").toString().trim(),
    fileLocation: (input.fileLocation ?? existing.fileLocation ?? "").toString().trim(),
    revisions: existing.revisions || [],
    createdAt: existing.createdAt || new Date().toISOString()
  };
}

// Traversal helpers: find a node by id anywhere in the client tree, and
// return its parent array + index too so callers can update/delete/insert.
function findClient(data, clientId) {
  return data.crmClients.find((c) => c.id === clientId);
}

function findProject(data, projectId) {
  for (const client of data.crmClients) {
    const project = (client.projects || []).find((p) => p.id === projectId);
    if (project) return { client, project };
  }
  return {};
}

function findPackage(data, packageId) {
  for (const client of data.crmClients) {
    for (const project of client.projects || []) {
      const pkg = (project.packages || []).find((pk) => pk.id === packageId);
      if (pkg) return { client, project, pkg };
    }
  }
  return {};
}

function findPlatform(data, platformId) {
  for (const client of data.crmClients) {
    for (const project of client.projects || []) {
      for (const pkg of project.packages || []) {
        const platform = (pkg.platforms || []).find((pl) => pl.id === platformId);
        if (platform) return { client, project, pkg, platform };
      }
    }
  }
  return {};
}

function findDeliverable(data, deliverableId) {
  for (const client of data.crmClients) {
    for (const project of client.projects || []) {
      for (const pkg of project.packages || []) {
        const deliverable = (pkg.deliverables || []).find((d) => d.id === deliverableId);
        if (deliverable) return { client, project, pkg, deliverable };
      }
    }
  }
  return {};
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
/* CRM: Clients / Projects / Packages / Platforms / Deliverables          */
/* ---------------------------------------------------------------------- */

app.get("/api/crm/clients", async (req, res) => {
  const data = await loadData();
  res.json(data.crmClients);
});

app.post("/api/crm/clients", async (req, res) => {
  try {
    const data = await loadData();
    const client = normalizeCrmClient(req.body, {});
    client.id = genId("CLI");
    client.projects = [];
    data.crmClients.push(client);
    await saveData(data);
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/crm/clients/:id", async (req, res) => {
  try {
    const data = await loadData();
    const client = findClient(data, req.params.id);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const updated = normalizeCrmClient(req.body, client);
    Object.assign(client, updated);
    await saveData(data);
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/crm/clients/:id", async (req, res) => {
  try {
    const data = await loadData();
    const idx = data.crmClients.findIndex((c) => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Client not found" });
    data.crmClients.splice(idx, 1);
    await saveData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Projects
app.post("/api/crm/clients/:clientId/projects", async (req, res) => {
  try {
    const data = await loadData();
    const client = findClient(data, req.params.clientId);
    if (!client) return res.status(404).json({ error: "Client not found" });
    const project = normalizeProject(req.body, {});
    project.id = genId("PRJ");
    project.packages = [];
    client.projects = client.projects || [];
    client.projects.push(project);
    await saveData(data);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/crm/projects/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { project } = findProject(data, req.params.id);
    if (!project) return res.status(404).json({ error: "Project not found" });
    Object.assign(project, normalizeProject(req.body, project));
    await saveData(data);
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/crm/projects/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { client } = findProject(data, req.params.id);
    if (!client) return res.status(404).json({ error: "Project not found" });
    client.projects = client.projects.filter((p) => p.id !== req.params.id);
    await saveData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Packages
app.post("/api/crm/projects/:projectId/packages", async (req, res) => {
  try {
    const data = await loadData();
    const { project } = findProject(data, req.params.projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });
    const pkg = normalizePackage(req.body, {});
    pkg.id = genId("PKG");
    pkg.payment = normalizePackagePayment(req.body.payment || {}, {});
    pkg.platforms = [];
    pkg.deliverables = [];
    project.packages = project.packages || [];
    project.packages.push(pkg);
    await saveData(data);
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/crm/packages/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { pkg } = findPackage(data, req.params.id);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    const updated = normalizePackage(req.body, pkg);
    updated.payment = pkg.payment;
    updated.platforms = pkg.platforms;
    updated.deliverables = pkg.deliverables;
    Object.assign(pkg, updated);
    await saveData(data);
    res.json(pkg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/crm/packages/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { project } = findPackage(data, req.params.id);
    if (!project) return res.status(404).json({ error: "Package not found" });
    project.packages = project.packages.filter((p) => p.id !== req.params.id);
    await saveData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Package payment (total/paid/dueDate) — optionally logs a history entry
// when `logEntry: true` is sent along with an `amount` (a new payment received).
app.put("/api/crm/packages/:id/payment", async (req, res) => {
  try {
    const data = await loadData();
    const { pkg } = findPackage(data, req.params.id);
    if (!pkg) return res.status(404).json({ error: "Package not found" });

    if (req.body.logEntry && Number(req.body.amount) > 0) {
      pkg.payment.history = pkg.payment.history || [];
      pkg.payment.history.push({
        id: genId("PAY"),
        date: req.body.date || new Date().toISOString().slice(0, 10),
        amount: Number(req.body.amount) || 0,
        note: (req.body.note || "").toString().trim()
      });
      const newPaid = (Number(pkg.payment.paid) || 0) + (Number(req.body.amount) || 0);
      pkg.payment = normalizePackagePayment({ total: pkg.payment.total, paid: newPaid, dueDate: pkg.payment.dueDate }, pkg.payment);
    } else {
      pkg.payment = normalizePackagePayment(req.body, pkg.payment);
    }
    await saveData(data);
    res.json(pkg.payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Platforms (Management packages — count-based, no per-post detail)
app.post("/api/crm/packages/:packageId/platforms", async (req, res) => {
  try {
    const data = await loadData();
    const { pkg } = findPackage(data, req.params.packageId);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    const platform = normalizePlatform(req.body, {});
    platform.id = genId("PLT");
    pkg.platforms = pkg.platforms || [];
    pkg.platforms.push(platform);
    await saveData(data);
    res.json(platform);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/crm/platforms/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { platform } = findPlatform(data, req.params.id);
    if (!platform) return res.status(404).json({ error: "Platform not found" });
    Object.assign(platform, normalizePlatform(req.body, platform));
    await saveData(data);
    res.json(platform);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/crm/platforms/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { pkg } = findPlatform(data, req.params.id);
    if (!pkg) return res.status(404).json({ error: "Platform not found" });
    pkg.platforms = pkg.platforms.filter((p) => p.id !== req.params.id);
    await saveData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deliverables (Deliverable packages — full per-item tracking incl. File Location)
app.post("/api/crm/packages/:packageId/deliverables", async (req, res) => {
  try {
    const data = await loadData();
    const { pkg } = findPackage(data, req.params.packageId);
    if (!pkg) return res.status(404).json({ error: "Package not found" });
    const deliverable = normalizeDeliverable(req.body, {});
    deliverable.id = genId("DEL");
    deliverable.revisions = [];
    pkg.deliverables = pkg.deliverables || [];
    pkg.deliverables.push(deliverable);
    await saveData(data);
    res.json(deliverable);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/crm/deliverables/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { deliverable } = findDeliverable(data, req.params.id);
    if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });
    const updated = normalizeDeliverable(req.body, deliverable);
    updated.revisions = deliverable.revisions;
    Object.assign(deliverable, updated);
    await saveData(data);
    res.json(deliverable);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/crm/deliverables/:id", async (req, res) => {
  try {
    const data = await loadData();
    const { pkg } = findDeliverable(data, req.params.id);
    if (!pkg) return res.status(404).json({ error: "Deliverable not found" });
    pkg.deliverables = pkg.deliverables.filter((d) => d.id !== req.params.id);
    await saveData(data);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/crm/deliverables/:id/revisions", async (req, res) => {
  try {
    const data = await loadData();
    const { deliverable } = findDeliverable(data, req.params.id);
    if (!deliverable) return res.status(404).json({ error: "Deliverable not found" });
    const revision = {
      id: genId("REV"),
      date: req.body.date || new Date().toISOString().slice(0, 10),
      note: (req.body.note || "").toString().trim()
    };
    deliverable.revisions = deliverable.revisions || [];
    deliverable.revisions.push(revision);
    await saveData(data);
    res.json(deliverable.revisions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      crmClients: Array.isArray(parsed.crmClients) ? parsed.crmClients : [],
      settings: {
        ...DEFAULT_DATA.settings,
        ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {})
      }
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