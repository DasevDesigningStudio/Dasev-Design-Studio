/* ============================================================================
   PayFlow — Payment Manager
   Backend server (Express.js)
   ============================================================================ */

const express = require("express");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

// Static files (index.html, style.css, script.js, etc.)
app.use(express.static(__dirname));

const DATA_FILE = path.join(__dirname, "data.json");

/* ---------------------------------------------------------------------- */
/* Data helpers                                                           */
/* ---------------------------------------------------------------------- */

const DEFAULT_DATA = {
  payments: [],
  categories: ["Post", "Reel", "Video", "Design", "Ads", "Management", "Other"],
  settings: {
    companyName: "My Agency",
    currency: "₹",
    themeColor: "teal",
    darkMode: false
  }
};

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_DATA, null, 2));
  }
}
ensureDataFile();

function loadData() {
  ensureDataFile();
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    raw = {};
  }

  // Normalize shape / fill in defaults defensively
  const data = {
    payments: Array.isArray(raw.payments) ? raw.payments : [],
    categories: Array.isArray(raw.categories) ? raw.categories : [...DEFAULT_DATA.categories],
    settings: {
      ...DEFAULT_DATA.settings,
      ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {})
    }
  };
  return data;
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
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
    .reduce((sum, p) => sum + (Number(p.totalAmount) || 0), 0);

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
  // its full history regardless of which month is selected.
  const monthlyIncome = {};
  payments.forEach((p) => {
    const key = (p.date || "").slice(0, 7);
    if (!key) return;
    monthlyIncome[key] = (monthlyIncome[key] || 0) + (Number(p.totalAmount) || 0);
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

/* ---------------------------------------------------------------------- */
/* File upload (for restore)                                              */
/* ---------------------------------------------------------------------- */

const upload = multer({ storage: multer.memoryStorage() });

/* ---------------------------------------------------------------------- */
/* Home page                                                              */
/* ---------------------------------------------------------------------- */

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

/* ---------------------------------------------------------------------- */
/* Payments CRUD                                                          */
/* ---------------------------------------------------------------------- */

app.get("/api/payments", (req, res) => {
  const data = loadData();
  res.json(data.payments);
});

app.post("/api/payments", (req, res) => {
  try {
    const data = loadData();
    const payment = normalizePayment(req.body, {});
    payment.id = nextPaymentId(data.payments);
    payment.createdAt = new Date().toISOString();
    data.payments.push(payment);
    saveData(data);
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/payments/:id", (req, res) => {
  try {
    const data = loadData();
    const idx = data.payments.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Payment not found" });
    }
    const updated = normalizePayment(req.body, data.payments[idx]);
    updated.id = data.payments[idx].id;
    data.payments[idx] = updated;
    saveData(data);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/payments/:id", (req, res) => {
  try {
    const data = loadData();
    const idx = data.payments.findIndex((p) => p.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Payment not found" });
    }
    data.payments.splice(idx, 1);
    saveData(data);
    res.json({ success: true, message: "Payment deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/payments/:id/duplicate", (req, res) => {
  try {
    const data = loadData();
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
    saveData(data);
    res.json(copy);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Clients                                                                */
/* ---------------------------------------------------------------------- */

app.get("/api/clients", (req, res) => {
  const data = loadData();
  res.json(buildClients(data.payments));
});

/* ---------------------------------------------------------------------- */
/* Categories                                                             */
/* ---------------------------------------------------------------------- */

app.get("/api/categories", (req, res) => {
  const data = loadData();
  res.json(data.categories);
});

app.post("/api/categories", (req, res) => {
  try {
    const data = loadData();
    const name = (req.body.name || "").toString().trim();
    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }
    if (data.categories.some((c) => c.toLowerCase() === name.toLowerCase())) {
      return res.status(400).json({ error: "Category already exists" });
    }
    data.categories.push(name);
    saveData(data);
    res.json(data.categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/categories/:name", (req, res) => {
  try {
    const data = loadData();
    const name = decodeURIComponent(req.params.name);
    const idx = data.categories.findIndex((c) => c === name);
    if (idx === -1) {
      return res.status(404).json({ error: "Category not found" });
    }
    data.categories.splice(idx, 1);
    saveData(data);
    res.json(data.categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Settings                                                               */
/* ---------------------------------------------------------------------- */

app.get("/api/settings", (req, res) => {
  const data = loadData();
  res.json(data.settings);
});

app.put("/api/settings", (req, res) => {
  try {
    const data = loadData();
    data.settings = { ...data.settings, ...req.body };
    saveData(data);
    res.json(data.settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Dashboard                                                              */
/* ---------------------------------------------------------------------- */

app.get("/api/dashboard", (req, res) => {
  const data = loadData();
  res.json(buildDashboard(data.payments, req.query.month));
});

/* ---------------------------------------------------------------------- */
/* Reports                                                                */
/* ---------------------------------------------------------------------- */

app.get("/api/reports", (req, res) => {
  const data = loadData();
  const type = req.query.type || "monthly";
  const status = req.query.status || "";
  res.json(buildReport(data.payments, type, status));
});

app.get("/api/reports/top-clients", (req, res) => {
  const data = loadData();
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

app.get("/api/export/csv", (req, res) => {
  const data = loadData();
  const csv = paymentsToCsv(data.payments);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="payments-export-${Date.now()}.csv"`);
  res.send(csv);
});

/* ---------------------------------------------------------------------- */
/* Backup / Restore                                                       */
/* ---------------------------------------------------------------------- */

app.get("/api/backup", (req, res) => {
  const data = loadData();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="payflow-backup-${Date.now()}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

app.post("/api/restore", upload.single("backupFile"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No backup file provided" });
    }
    const parsed = JSON.parse(req.file.buffer.toString("utf8"));
    const restored = {
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      categories: Array.isArray(parsed.categories) ? parsed.categories : [...DEFAULT_DATA.categories],
      settings: {
        ...DEFAULT_DATA.settings,
        ...(parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {})
      }
    };
    saveData(restored);
    res.json({ success: true, message: "Backup restored successfully" });
  } catch (err) {
    res.status(500).json({ error: "Invalid backup file: " + err.message });
  }
});

/* ---------------------------------------------------------------------- */
/* Start server                                                           */
/* ---------------------------------------------------------------------- */

app.listen(PORT, () => {
  console.log(`Payment Manager running on http://localhost:${PORT}`);
});