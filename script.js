/* ============================================================================
   PayFlow — Payment Manager
   Frontend logic (vanilla JS) — talks to the Express API in server.js
   ============================================================================ */

(() => {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* State                                                              */
  /* ------------------------------------------------------------------ */
  const state = {
    payments: [],
    categories: [],
    expenses: [],
    expenseCategories: [],
    settings: { companyName: "My Agency", currency: "₹", themeColor: "teal", darkMode: false },
    dashboard: null,
    dashboardMonth: currentMonthKey(),
    overview: null,
    overviewMonth: currentMonthKey(),
    clients: [],
    leads: [],
    paymentsFilterMonth: "all",
    clientsFilterMonth: "all",
    expensesFilterMonth: "all",
    editingPaymentId: null,
    editingExpenseId: null,
    editingLeadId: null,
    confirmAction: null,
    charts: { pie: null, monthly: null, category: null, expenseCategory: null },

    // Packages (Post & Reel / Management) — live inside a Client's detail page
    packages: [],
    platformOptions: [],
    clientProfiles: {},
    editingPackageId: null,
    newPackageType: "postReel",  // chosen in the type-picker before the package form opens

    // Client detail page (Overview / One-Time / Package tabs)
    currentClient: null,         // the client object the detail page is showing
    currentClientKey: null,      // mobile || clientName
    clientDetailTab: "overview",
    clientOverview: null,
    clientJobs: [],
    clientPackages: [],
    oneTimeFilter: "Active",
    packageFilter: "Active",
    editingJobId: null,
    currentPackageId: null       // package currently open in its drawer
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  /* ------------------------------------------------------------------ */
  /* API helpers                                                        */
  /* ------------------------------------------------------------------ */
  async function api(url, options = {}) {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...options
    });
    if (!res.ok) {
      let msg = "Request failed";
      try {
        const body = await res.json();
        msg = body.error || msg;
      } catch (_) {}
      throw new Error(msg);
    }
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return res.json();
    return res;
  }

  const Api = {
    getPayments: () => api("/api/payments"),
    createPayment: (data) => api("/api/payments", { method: "POST", body: JSON.stringify(data) }),
    updatePayment: (id, data) => api(`/api/payments/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deletePayment: (id) => api(`/api/payments/${id}`, { method: "DELETE" }),
    duplicatePayment: (id) => api(`/api/payments/${id}/duplicate`, { method: "POST" }),

    getClients: (month) => api(`/api/clients?month=${encodeURIComponent(month || "all")}`),
    getClientOverview: (key) => api(`/api/clients/${encodeURIComponent(key)}/overview`),
    getClientLedger: (key) => api(`/api/clients/${encodeURIComponent(key)}/ledger`),

    getLeads: () => api("/api/leads"),
    createLead: (data) => api("/api/leads", { method: "POST", body: JSON.stringify(data) }),
    updateLead: (id, data) => api(`/api/leads/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteLead: (id) => api(`/api/leads/${id}`, { method: "DELETE" }),
    convertLead: (id, data) => api(`/api/leads/${id}/convert`, { method: "POST", body: JSON.stringify(data || {}) }),

    getCategories: () => api("/api/categories"),
    addCategory: (name) => api("/api/categories", { method: "POST", body: JSON.stringify({ name }) }),
    deleteCategory: (name) => api(`/api/categories/${encodeURIComponent(name)}`, { method: "DELETE" }),

    getExpenses: () => api("/api/expenses"),
    createExpense: (data) => api("/api/expenses", { method: "POST", body: JSON.stringify(data) }),
    updateExpense: (id, data) => api(`/api/expenses/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteExpense: (id) => api(`/api/expenses/${id}`, { method: "DELETE" }),
    getExpenseCategories: () => api("/api/expense-categories"),
    addExpenseCategory: (name) => api("/api/expense-categories", { method: "POST", body: JSON.stringify({ name }) }),

    getSettings: () => api("/api/settings"),
    updateSettings: (data) => api("/api/settings", { method: "PUT", body: JSON.stringify(data) }),

    getPackages: (params) => api(`/api/packages${params ? `?${params}` : ""}`),
    getPackage: (id) => api(`/api/packages/${id}`),
    createPackage: (data) => api("/api/packages", { method: "POST", body: JSON.stringify(data) }),
    updatePackage: (id, data) => api(`/api/packages/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deletePackage: (id) => api(`/api/packages/${id}`, { method: "DELETE" }),
    addPackagePayment: (id, data) => api(`/api/packages/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
    deletePackagePayment: (id, entryId) => api(`/api/packages/${id}/payments/${entryId}`, { method: "DELETE" }),

    getPlatformOptions: () => api("/api/platform-options"),

    getClientProfiles: () => api("/api/client-profiles"),
    updateClientProfile: (key, data) => api(`/api/client-profiles/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(data) }),

    getDashboard: (month) => api(`/api/dashboard?month=${encodeURIComponent(month || "all")}`),
    getOverview: (month) => api(`/api/overview?month=${encodeURIComponent(month || "all")}`),

    getReport: (type, status) => api(`/api/reports?type=${encodeURIComponent(type)}&status=${encodeURIComponent(status || "")}`),
    getTopClients: () => api("/api/reports/top-clients")
  };

  /* ------------------------------------------------------------------ */
  /* Utilities                                                          */
  /* ------------------------------------------------------------------ */
  function fmtMoney(n) {
    const val = Number(n) || 0;
    const symbol = state.settings.currency || "₹";
    return symbol + val.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }

  function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthKeyOf(dateStr) {
    return (dateStr || "").slice(0, 7);
  }

  // Short "Jul 2026" style label used for month dropdowns and chart axes.
  function monthShortLabel(key) {
    if (!key || key === "all") return "All Months";
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    if (isNaN(date)) return key;
    return date.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
  }

  // Just the 3-letter month abbreviation ("Jul"), used for compact chart axes.
  function monthAbbrev(key) {
    if (!key || key === "all") return key;
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    if (isNaN(date)) return key;
    return date.toLocaleDateString("en-IN", { month: "short" });
  }

  function availableMonthsFrom(list, dateField = "date") {
    const months = new Set(list.map((item) => monthKeyOf(item[dateField])).filter(Boolean));
    return Array.from(months).sort((a, b) => b.localeCompare(a));
  }

  function populateMonthSelect(sel, months, currentValue) {
    if (!sel) return;
    sel.innerHTML = `<option value="all">All Months</option>` +
      months.map((key) => `<option value="${key}">${monthShortLabel(key)}</option>`).join("");
    sel.value = months.includes(currentValue) || currentValue === "all" ? currentValue : "all";
  }

  // Mirrors server-side buildClients() so we can group the already-loaded
  // payments list by client without another round trip to the API.
  function buildClientsFromPayments(payments) {
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
      if (p.businessName) c.businessName = p.businessName;
      if (p.instagram) c.instagram = p.instagram;
    });
    return Array.from(map.values()).sort((a, b) => b.totalBusiness - a.totalBusiness);
  }

  function fmtDate(d) {
    if (!d) return "—";
    const dt = new Date(d);
    if (isNaN(dt)) return d;
    return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function escapeHtml(str) {
    return (str ?? "").toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function initials(name) {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function statusClass(status) {
    if (status === "Paid") return "Paid";
    if (status === "Advance") return "Advance";
    return "Pending";
  }

  function debounce(fn, delay = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                             */
  /* ------------------------------------------------------------------ */
  function showToast(message, type = "info", title = "") {
    const container = $("#toastContainer");
    if (!container) return;
    const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-exclamation" : "fa-circle-info";
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="toast-text">
        <b>${escapeHtml(title || (type === "success" ? "Success" : type === "error" ? "Error" : "Notice"))}</b>
        <span>${escapeHtml(message)}</span>
      </div>
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 300);
    }, 3200);
  }

  /* ------------------------------------------------------------------ */
  /* Sidebar / navigation                                               */
  /* ------------------------------------------------------------------ */
  function setActiveView(view) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    const target = $(`#view-${view}`);
    if (target) target.classList.add("active");

    $$(".nav-item[data-view]").forEach((nav) => {
      nav.classList.toggle("active", nav.dataset.view === view);
    });

    // Lazy-load per-view data
    if (view === "overview") loadOverview().catch((err) => showToast("Failed to load overview: " + err.message, "error"));
    if (view === "payments") renderPaymentsView();
    if (view === "clients") renderClientsView();
    if (view === "leads") renderLeadsView();
    if (view === "reports") runReport();
    if (view === "categories") renderCategoriesView();
    if (view === "expenses") renderExpensesView();
    if (view === "export") populateInvoiceSelect();
    if (view === "settings") renderSettingsForm();

    closeSidebarMobile();
  }

  function initNavigation() {
    $$(".nav-item[data-view]").forEach((nav) => {
      nav.addEventListener("click", (e) => {
        e.preventDefault();
        const view = nav.dataset.view;
        window.location.hash = view;
        setActiveView(view);
      });
    });

    $$('.link-btn[data-view]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const view = btn.dataset.view;
        window.location.hash = view;
        setActiveView(view);
      });
    });

    window.addEventListener("hashchange", () => {
      const view = (window.location.hash || "#dashboard").slice(1);
      setActiveView(view);
    });
  }

  function openSidebarMobile() {
    $("#sidebar").classList.add("open");
    $("#sidebarOverlay").classList.add("show");
  }
  function closeSidebarMobile() {
    $("#sidebar").classList.remove("open");
    $("#sidebarOverlay").classList.remove("show");
  }

  function initSidebarToggle() {
    $("#burgerBtn").addEventListener("click", openSidebarMobile);
    $("#sidebarClose").addEventListener("click", closeSidebarMobile);
    $("#sidebarOverlay").addEventListener("click", closeSidebarMobile);
  }

  /* ------------------------------------------------------------------ */
  /* Dark mode / theme                                                  */
  /* ------------------------------------------------------------------ */
  function applySettingsToUI() {
    document.body.classList.toggle("dark-mode", !!state.settings.darkMode);
    document.body.setAttribute("data-theme", state.settings.themeColor || "teal");
    $("#sidebarAgencyName").textContent = state.settings.companyName || "My Agency";

    const darkIcon = $("#darkModeToggle i");
    if (darkIcon) darkIcon.className = state.settings.darkMode ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }

  async function toggleDarkMode() {
    state.settings.darkMode = !state.settings.darkMode;
    applySettingsToUI();
    try {
      await Api.updateSettings({ darkMode: state.settings.darkMode });
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function initDarkModeToggle() {
    $("#darkModeToggle").addEventListener("click", toggleDarkMode);
  }

  /* ------------------------------------------------------------------ */
  /* Greeting / topbar date                                             */
  /* ------------------------------------------------------------------ */
  function renderGreeting() {
    const hour = new Date().getHours();
    const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    const name = (state.settings.companyName || "Jay Kodavla").split(" ")[0];
    $("#greetingText").textContent = `Good ${part}, ${name} 👋`;
    $("#topbarDate").textContent = new Date().toLocaleDateString("en-IN", {
      weekday: "long", day: "2-digit", month: "long", year: "numeric"
    });
  }

  /* ------------------------------------------------------------------ */
  /* Notifications (derived from upcoming due payments)                 */
  /* ------------------------------------------------------------------ */
  function renderNotifications() {
    const list = $("#notifList");
    const dot = $("#notifDot");
    if (!state.dashboard) return;
    const upcoming = state.dashboard.upcomingDue || [];
    if (!upcoming.length) {
      list.innerHTML = `<div class="notif-empty" style="padding:16px; font-size:12.5px; color:var(--text-muted);">No pending notifications.</div>`;
      dot.hidden = true;
      return;
    }
    dot.hidden = false;
    list.innerHTML = upcoming.map((p) => `
      <div class="notif-item" style="padding:12px 16px; border-bottom:1px solid var(--border); font-size:12.5px;">
        <b>${escapeHtml(p.clientName)}</b> has ${fmtMoney(p.pendingAmount)} pending, due ${fmtDate(p.dueDate)}.
      </div>
    `).join("");
  }

  function initNotifications() {
    $("#notifBtn").addEventListener("click", (e) => {
      e.stopPropagation();
      const panel = $("#notifPanel");
      panel.hidden = !panel.hidden;
    });
    document.addEventListener("click", (e) => {
      const panel = $("#notifPanel");
      if (!panel.hidden && !panel.contains(e.target) && e.target.id !== "notifBtn") {
        panel.hidden = true;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard                                                          */
  /* ------------------------------------------------------------------ */
  async function loadDashboard() {
    state.dashboard = await Api.getDashboard(state.dashboardMonth);
    renderDashboard();
    renderNotifications();
  }

  function monthLabel(key) {
    if (key === "all") return "All Time";
    const [y, m] = key.split("-");
    const date = new Date(Number(y), Number(m) - 1, 1);
    const label = date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    return key === currentMonthKey() ? `${label} (Current)` : label;
  }

  function renderMonthFilter(d) {
    const sel = $("#dashboardMonthFilter");
    if (!sel) return;

    const months = new Set(d.availableMonths || []);
    months.add(currentMonthKey());
    const sorted = Array.from(months).sort((a, b) => b.localeCompare(a));
    const options = ["all", ...sorted];
    sel.innerHTML = options.map((key) => `<option value="${key}">${monthLabel(key)}</option>`).join("");
    sel.value = state.dashboardMonth;
    sel.classList.toggle("is-current", state.dashboardMonth === currentMonthKey());
  }

  function renderDashboard() {
    const d = state.dashboard;
    if (!d) return;

    renderMonthFilter(d);

    $("#statTotalBusiness").textContent = fmtMoney(d.totalBusiness);
    $("#statReceived").textContent = fmtMoney(d.received);
    $("#statPending").textContent = fmtMoney(d.pending);
    $("#statClients").textContent = d.totalClients;
    $("#statMonthlyIncome").textContent = fmtMoney(d.monthlyBusiness);
    const monthlyIncomeLabel = $("#statMonthlyIncomeLabel");
    if (monthlyIncomeLabel) monthlyIncomeLabel.textContent = `Monthly Income (${monthShortLabel(currentMonthKey())})`;

    // Expenses + profit for the current calendar month (mirrors how
    // Monthly Income always reflects the actual current month too).
    const todayStr = new Date().toISOString().slice(0, 10);
    const thisMonth = currentMonthKey();
    const monthlyExpenses = state.expenses
      .filter((e) => monthKeyOf(e.date) === thisMonth)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const spentToday = state.expenses
      .filter((e) => e.date === todayStr)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const monthlyProfit = (d.monthlyBusiness || 0) - monthlyExpenses;

    const monthlyExpensesLabel = $("#statMonthlyExpensesLabel");
    if (monthlyExpensesLabel) monthlyExpensesLabel.textContent = `This Month Expenses (${monthShortLabel(thisMonth)})`;
    $("#statMonthlyExpenses").textContent = fmtMoney(monthlyExpenses);

    const monthlyProfitLabel = $("#statMonthlyProfitLabel");
    if (monthlyProfitLabel) monthlyProfitLabel.textContent = `This Month Profit (${monthShortLabel(thisMonth)})`;
    $("#statMonthlyProfit").textContent = fmtMoney(monthlyProfit);

    const profitCard = $("#statMonthlyProfitCard");
    const profitTrend = $("#statMonthlyProfitTrend");
    if (profitCard && profitTrend) {
      profitCard.classList.remove("green", "rose");
      profitCard.classList.add(monthlyProfit >= 0 ? "green" : "rose");
      profitTrend.classList.remove("up", "down");
      profitTrend.classList.add(monthlyProfit >= 0 ? "up" : "down");
      profitTrend.innerHTML = monthlyProfit >= 0
        ? `<i class="fa-solid fa-arrow-trend-up"></i>`
        : `<i class="fa-solid fa-arrow-trend-down"></i>`;
    }

    $("#todayCollected").textContent = fmtMoney(d.todaysCollection);
    $("#todayPending").textContent = fmtMoney(d.todaysPending);
    const todaySpentEl = $("#todaySpent");
    if (todaySpentEl) todaySpentEl.textContent = fmtMoney(spentToday);
    $("#progressPercent").textContent = `${d.paymentProgress}%`;
    $("#progressFill").style.width = `${Math.min(d.paymentProgress, 100)}%`;

    // Recent payments table
    const recentBody = $("#recentPaymentsTable tbody");
    recentBody.innerHTML = (d.recentPayments || []).map((p) => `
      <tr>
        <td>${escapeHtml(p.clientName)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${fmtMoney(p.totalAmount)}</td>
        <td><span class="badge ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
        <td>${fmtDate(p.date)}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No payments yet.</td></tr>`;

    // Upcoming due table
    const upcomingBody = $("#upcomingDueTable tbody");
    upcomingBody.innerHTML = (d.upcomingDue || []).map((p) => `
      <tr>
        <td>${escapeHtml(p.clientName)}</td>
        <td>${fmtMoney(p.pendingAmount)}</td>
        <td>${fmtDate(p.dueDate)}</td>
      </tr>
    `).join("") || `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">Nothing due.</td></tr>`;

    renderCharts(d);
  }

  function renderCharts(d) {
    if (typeof Chart === "undefined") return;

    // Status pie chart
    const pieCtx = $("#statusPieChart");
    if (pieCtx) {
      const counts = d.statusCounts || { Paid: 0, Advance: 0, Pending: 0 };
      if (state.charts.pie) state.charts.pie.destroy();
      state.charts.pie = new Chart(pieCtx, {
        type: "doughnut",
        data: {
          labels: ["Paid", "Advance", "Pending"],
          datasets: [{
            data: [counts.Paid, counts.Advance, counts.Pending],
            backgroundColor: ["#1f9d75", "#e0a300", "#e2544c"],
            borderWidth: 0
          }]
        },
        options: { plugins: { legend: { position: "bottom" } }, cutout: "65%" }
      });
    }

    // Monthly income trend
    const monthlyCtx = $("#monthlyIncomeChart");
    if (monthlyCtx) {
      const entries = Object.entries(d.monthlyIncome || {}).sort(([a], [b]) => a.localeCompare(b));
      if (state.charts.monthly) state.charts.monthly.destroy();
      state.charts.monthly = new Chart(monthlyCtx, {
        type: "line",
        data: {
          labels: entries.map(([k]) => monthAbbrev(k)),
          datasets: [{
            label: "Income",
            data: entries.map(([, v]) => v),
            borderColor: "#12756c",
            backgroundColor: "rgba(18,117,108,0.12)",
            fill: true,
            tension: 0.35
          }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }

    // Category chart
    const categoryCtx = $("#categoryChart");
    if (categoryCtx) {
      const entries = Object.entries(d.categoryTotals || {});
      if (state.charts.category) state.charts.category.destroy();
      state.charts.category = new Chart(categoryCtx, {
        type: "bar",
        data: {
          labels: entries.map(([k]) => k),
          datasets: [{
            label: "Business",
            data: entries.map(([, v]) => v),
            backgroundColor: "#7c6cf0"
          }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Overview — computed analytics (One-Time Jobs + Packages + Leads)   */
  /* ------------------------------------------------------------------ */
  async function loadOverview() {
    state.overview = await Api.getOverview(state.overviewMonth);
    renderOverview();
  }

  function renderOverviewMonthFilter(o) {
    const sel = $("#overviewMonthFilter");
    if (!sel) return;
    const months = new Set(o.availableMonths || []);
    months.add(currentMonthKey());
    const sorted = Array.from(months).sort((a, b) => b.localeCompare(a));
    const options = ["all", ...sorted];
    sel.innerHTML = options.map((key) => `<option value="${key}">${monthLabel(key)}</option>`).join("");
    sel.value = state.overviewMonth;
  }

  function renderOverview() {
    const o = state.overview;
    if (!o) return;

    renderOverviewMonthFilter(o);
    const monthText = o.selectedMonth === "all" ? "All Time" : monthShortLabel(o.selectedMonth);

    // Top stat cards
    $("#ovTotalClients").textContent = o.clients.total;
    $("#ovNewClients").textContent = `↑ ${o.clients.newThisMonth}`;
    $("#ovOneTimeClients").textContent = o.clients.oneTimeOnly;
    $("#ovOneTimeClientsPct").textContent = `${o.clients.total ? Math.round((o.clients.oneTimeOnly / o.clients.total) * 100) : 0}% of total clients`;
    $("#ovPackageClients").textContent = o.clients.package;
    $("#ovPackageClientsPct").textContent = `${o.clients.total ? Math.round((o.clients.package / o.clients.total) * 100) : 0}% of total clients`;
    $("#ovTotalBusinessValue").textContent = fmtMoney(o.business.totalValue);

    // Income split
    $("#ovIncomeHint").textContent = monthText;
    $("#ovOneTimeIncomeVal").textContent = fmtMoney(o.business.oneTimeIncome);
    $("#ovPackageIncomeVal").textContent = fmtMoney(o.business.packageIncome);
    const incomeSum = o.business.oneTimeIncome + o.business.packageIncome;
    $("#ovOneTimeIncomeBar").style.width = `${incomeSum > 0 ? Math.round((o.business.oneTimeIncome / incomeSum) * 100) : 0}%`;
    $("#ovPackageIncomeBar").style.width = `${incomeSum > 0 ? Math.round((o.business.packageIncome / incomeSum) * 100) : 0}%`;
    $("#ovMrr").textContent = fmtMoney(o.business.mrr);
    $("#ovAvgOneTime").innerHTML = `${fmtMoney(o.business.avgRevPerOneTimeClient)} <span class="ov-faint">One-Time</span>`;
    $("#ovAvgPackage").textContent = fmtMoney(o.business.avgRevPerPackageClient);
    const multiplier = o.business.avgRevPerOneTimeClient > 0
      ? (o.business.avgRevPerPackageClient / o.business.avgRevPerOneTimeClient)
      : 0;
    $("#ovAvgMultiplier").textContent = multiplier > 0 ? `(${multiplier.toFixed(1)}x higher)` : "";

    // Completion donut
    const c = o.completion;
    const completedPct = c.totalJobs ? Math.round((c.jobsCompleted / c.totalJobs) * 100) : 0;
    $("#ovCompletionDonut").style.background =
      `conic-gradient(var(--success) 0% ${completedPct}%, var(--warning) ${completedPct}% 100%)`;
    $("#ovTotalJobs").textContent = c.totalJobs;
    $("#ovJobsCompleted").textContent = `${c.jobsCompleted} Completed`;
    $("#ovJobsCompletedPct").textContent = `${completedPct}%`;
    $("#ovJobsActive").textContent = `${c.jobsActive} Active/Running`;
    $("#ovJobsActivePct").textContent = `${100 - completedPct}%`;
    $("#ovPackagesCompleted").innerHTML = `${c.packagesCompleted} <span class="ov-faint">/ ${c.packagesTotal}</span>`;
    $("#ovPackagesRunning").textContent = c.packagesRunning;

    // Package duration
    const durationRows = $("#ovDurationRows");
    if (durationRows) {
      durationRows.innerHTML = (o.packageDuration || []).map((d) => {
        const pct = o.maxDurationCount ? Math.round((d.count / o.maxDurationCount) * 100) : 0;
        const pop = d.count === o.maxDurationCount && d.count > 0 ? `<span class="ov-dur-pop">Popular</span>` : "";
        return `
          <div class="ov-dur-row">
            <div class="ov-dur-label">${escapeHtml(d.label)}</div>
            <div class="ov-dur-track"><div class="ov-dur-fill" style="width:${Math.max(pct, 6)}%;"><span>${d.count}</span></div></div>
            <div class="ov-dur-count">${d.count} pkg${d.count === 1 ? "" : "s"} ${pop}</div>
          </div>`;
      }).join("") || `<p style="color:var(--text-muted);font-size:12.5px;">No packages yet.</p>`;
    }

    // Upsell funnel
    const u = o.upsell;
    $("#ovFunnelAll").textContent = `${u.oneTimeClients} One-Time Clients`;
    $("#ovFunnelConverted").style.width = `${Math.max(u.conversionPercent, u.convertedClients > 0 ? 4 : 0)}%`;
    $("#ovFunnelConverted").textContent = `${u.convertedClients} Converted →`;
    $("#ovFunnelPct").textContent = `${u.conversionPercent}%`;
    $("#ovRepeatRate").textContent = `${u.repeatPercent}%`;
    $("#ovRepeatNote").textContent = `${u.repeatClients} of ${u.packageClients} package clients renewed 2+ packages`;

    // Income by service
    const serviceRows = $("#ovServiceRows");
    $("#ovServiceHint").textContent = monthText;
    const palette = ["var(--violet)", "var(--blue)", "var(--teal-400)", "var(--warning)", "var(--success)", "var(--danger)"];
    if (serviceRows) {
      serviceRows.innerHTML = (o.incomeByService || []).map((s, i) => `
        <div class="ov-cat-item">
          <div class="ov-name">${escapeHtml(s.category)}</div>
          <div class="ov-bar"><i style="width:${s.percent}%;background:${palette[i % palette.length]};"></i></div>
          <div class="ov-val">${fmtMoney(s.amount)}</div>
        </div>
      `).join("") || `<p style="color:var(--text-muted);font-size:12.5px;">No income recorded yet.</p>`;
    }

    // Health signals
    const h = o.health;
    $("#ovOverdue").textContent = h.overduePayments;
    $("#ovPackagesEnding").textContent = h.packagesEndingThisMonth;
    $("#ovExpectedCollectionMonth").textContent = `(${monthShortLabel(currentMonthKey())})`;
    $("#ovExpectedCollection").textContent = fmtMoney(h.expectedCollection);
    $("#ovOutstanding").textContent = fmtMoney(h.totalOutstanding);
    $("#ovFollowups").textContent = h.followupsToday;
    $("#ovNewLeads").textContent = h.newLeadsThisWeek;
  }

  function initOverviewFilter() {
    const sel = $("#overviewMonthFilter");
    if (!sel) return;
    sel.addEventListener("change", async () => {
      state.overviewMonth = sel.value;
      try {
        await loadOverview();
      } catch (err) {
        showToast("Failed to load overview: " + err.message, "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Categories (dropdowns + filters)                                   */
  /* ------------------------------------------------------------------ */
  function populateCategorySelects() {
    const targets = [$("#fCategory"), $("#filterCategory"), $("#reportStatus") ? null : null];
    // Payment form category select (no blank option, required)
    const fCat = $("#fCategory");
    if (fCat) {
      fCat.innerHTML = state.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }
    // Payments filter select (keep "All Categories" first)
    const filterCat = $("#filterCategory");
    if (filterCat) {
      filterCat.innerHTML = `<option value="">All Categories</option>` +
        state.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }
  }

  function renderCategoriesView() {
    const grid = $("#categoryGrid");
    grid.innerHTML = state.categories.map((c) => `
      <div class="category-chip" data-category="${escapeHtml(c)}">
        <span class="cat-name"><i class="fa-solid fa-tag"></i>${escapeHtml(c)}</span>
        <button type="button" class="delete-category-btn" data-category="${escapeHtml(c)}" aria-label="Delete category">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>
    `).join("") || `<p style="color:var(--text-muted);">No categories yet.</p>`;

    $$(".delete-category-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.dataset.category;
        openConfirm(`Delete category "${name}"?`, "This will not delete existing payments in this category.", async () => {
          try {
            state.categories = await Api.deleteCategory(name);
            populateCategorySelects();
            renderCategoriesView();
            showToast("Category deleted", "success");
          } catch (err) {
            showToast(err.message, "error");
          }
        });
      });
    });
  }

  function initCategoryForm() {
    $("#addCategoryForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#newCategoryInput");
      const name = input.value.trim();
      if (!name) return;
      try {
        state.categories = await Api.addCategory(name);
        input.value = "";
        populateCategorySelects();
        renderCategoriesView();
        showToast("Category added", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Payments view                                                      */
  /* ------------------------------------------------------------------ */
  function getFilteredSortedPayments() {
    const search = ($("#paymentSearch").value || "").toLowerCase();
    const month = $("#filterMonth") ? $("#filterMonth").value : "all";
    const category = $("#filterCategory").value;
    const status = $("#filterStatus").value;
    const sort = $("#sortPayments").value;

    let list = state.payments.filter((p) => {
      const matchesSearch = !search ||
        [p.clientName, p.mobile, p.businessName, p.instagram, p.category, p.status, String(p.totalAmount)]
          .some((f) => (f || "").toString().toLowerCase().includes(search));
      const matchesMonth = !month || month === "all" || monthKeyOf(p.date) === month;
      const matchesCategory = !category || p.category === category;
      const matchesStatus = !status || p.status === status;
      return matchesSearch && matchesMonth && matchesCategory && matchesStatus;
    });

    list.sort((a, b) => {
      switch (sort) {
        case "date-asc": return new Date(a.date) - new Date(b.date);
        case "amount-desc": return b.totalAmount - a.totalAmount;
        case "amount-asc": return a.totalAmount - b.totalAmount;
        case "name-asc": return (a.clientName || "").localeCompare(b.clientName || "");
        case "date-desc":
        default: return new Date(b.date) - new Date(a.date);
      }
    });

    return list;
  }

  function populatePaymentsMonthFilter() {
    const sel = $("#filterMonth");
    if (!sel) return;
    const months = availableMonthsFrom(state.payments);
    populateMonthSelect(sel, months, state.paymentsFilterMonth);
  }

  function renderPaymentsView() {
    populatePaymentsMonthFilter();
    const list = getFilteredSortedPayments();
    const tbody = $("#paymentsTable tbody");
    const empty = $("#paymentsEmpty");

    if (!list.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tbody.innerHTML = list.map((p) => `
      <tr>
        <td>${escapeHtml(p.clientName)}</td>
        <td>${escapeHtml(p.businessName)}</td>
        <td>${escapeHtml(p.category)}</td>
        <td>${fmtMoney(p.totalAmount)}</td>
        <td>${fmtMoney(p.paidAmount)}</td>
        <td>${fmtMoney(p.pendingAmount)}</td>
        <td><span class="badge ${statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
        <td>${fmtDate(p.date)}</td>
        <td class="row-actions">
          <button class="icon-btn edit-payment-btn" data-id="${p.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn duplicate-payment-btn" data-id="${p.id}" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
          <button class="icon-btn delete-payment-btn" data-id="${p.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join("");

    $$(".edit-payment-btn").forEach((btn) => btn.addEventListener("click", () => openPaymentModal(btn.dataset.id)));
    $$(".duplicate-payment-btn").forEach((btn) => btn.addEventListener("click", () => duplicatePayment(btn.dataset.id)));
    $$(".delete-payment-btn").forEach((btn) => btn.addEventListener("click", () => {
      const payment = state.payments.find((p) => p.id === btn.dataset.id);
      openConfirm(
        "Delete this payment?",
        `This will permanently delete the payment record for ${payment ? escapeHtml(payment.clientName) : "this client"}.`,
        async () => {
          try {
            await Api.deletePayment(btn.dataset.id);
            await refreshPaymentsData();
            showToast("Payment deleted", "success");
          } catch (err) {
            showToast(err.message, "error");
          }
        }
      );
    }));
  }

  async function duplicatePayment(id) {
    try {
      await Api.duplicatePayment(id);
      await refreshPaymentsData();
      showToast("Payment duplicated", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function initPaymentsToolbar() {
    $("#paymentSearch").addEventListener("input", debounce(renderPaymentsView, 200));
    $("#filterMonth").addEventListener("change", () => {
      state.paymentsFilterMonth = $("#filterMonth").value;
      renderPaymentsView();
    });
    $("#filterCategory").addEventListener("change", renderPaymentsView);
    $("#filterStatus").addEventListener("change", renderPaymentsView);
    $("#sortPayments").addEventListener("change", renderPaymentsView);
  }

  /* ------------------------------------------------------------------ */
  /* Payment modal (add/edit)                                           */
  /* ------------------------------------------------------------------ */
  function recalcPendingAmount() {
    const total = Number($("#fTotalAmount").value) || 0;
    const paid = Number($("#fPaidAmount").value) || 0;
    const pending = Math.max(total - paid, 0);
    $("#fPendingAmount").value = pending.toFixed(2);

    // Auto-suggest status based on amounts (user can still override)
    if (paid <= 0) $("#fStatus").value = "Pending";
    else if (paid >= total && total > 0) $("#fStatus").value = "Paid";
    else $("#fStatus").value = "Advance";
  }

  function openPaymentModal(id = null) {
    state.editingPaymentId = id;
    const overlay = $("#paymentModalOverlay");
    const title = $("#paymentModalTitle");
    const form = $("#paymentForm");
    form.reset();

    populateCategorySelects();

    if (id) {
      const payment = state.payments.find((p) => p.id === id);
      if (!payment) return;
      title.textContent = "Edit Payment";
      $("#paymentId").value = payment.id;
      $("#fClientName").value = payment.clientName || "";
      $("#fMobile").value = payment.mobile || "";
      $("#fBusinessName").value = payment.businessName || "";
      $("#fInstagram").value = payment.instagram || "";
      $("#fWorkDetails").value = payment.workDetails || "";
      $("#fCategory").value = payment.category || "";
      $("#fDate").value = payment.date || "";
      $("#fTotalAmount").value = payment.totalAmount || 0;
      $("#fPaidAmount").value = payment.paidAmount || 0;
      $("#fPendingAmount").value = payment.pendingAmount || 0;
      $("#fStatus").value = payment.status || "Pending";
      $("#fDueDate").value = payment.dueDate || "";
      $("#fNotes").value = payment.notes || "";
    } else {
      title.textContent = "Add Payment";
      $("#paymentId").value = "";
      $("#fDate").value = new Date().toISOString().slice(0, 10);
      $("#fPaidAmount").value = 0;
      $("#fPendingAmount").value = 0;
      $("#fStatus").value = "Pending";
    }

    overlay.hidden = false;
  }

  function closePaymentModal() {
    $("#paymentModalOverlay").hidden = true;
    state.editingPaymentId = null;
  }

  function collectPaymentFormData() {
    return {
      clientName: $("#fClientName").value.trim(),
      mobile: $("#fMobile").value.trim(),
      businessName: $("#fBusinessName").value.trim(),
      instagram: $("#fInstagram").value.trim(),
      workDetails: $("#fWorkDetails").value.trim(),
      category: $("#fCategory").value,
      date: $("#fDate").value,
      totalAmount: Number($("#fTotalAmount").value) || 0,
      paidAmount: Number($("#fPaidAmount").value) || 0,
      status: $("#fStatus").value,
      dueDate: $("#fDueDate").value,
      notes: $("#fNotes").value.trim()
    };
  }

  async function refreshPaymentsData() {
    state.payments = await Api.getPayments();
    renderPaymentsView();
    await loadDashboard();
  }

  function initPaymentModal() {
    $("#quickAddBtn").addEventListener("click", () => openPaymentModal());
    $("#addPaymentBtn").addEventListener("click", () => openPaymentModal());
    $("#closePaymentModal").addEventListener("click", closePaymentModal);
    $("#cancelPaymentBtn").addEventListener("click", closePaymentModal);
    $("#paymentModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "paymentModalOverlay") closePaymentModal();
    });

    $("#fTotalAmount").addEventListener("input", recalcPendingAmount);
    $("#fPaidAmount").addEventListener("input", recalcPendingAmount);

    $("#paymentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = collectPaymentFormData();
      const id = $("#paymentId").value;
      try {
        if (id) {
          await Api.updatePayment(id, data);
          showToast("Payment updated", "success");
        } else {
          await Api.createPayment(data);
          showToast("Payment added", "success");
        }
        closePaymentModal();
        await refreshPaymentsData();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Confirmation dialog                                                */
  /* ------------------------------------------------------------------ */
  function openConfirm(title, message, action) {
    $("#confirmTitle").textContent = title;
    $("#confirmMessage").textContent = message;
    state.confirmAction = action;
    $("#confirmOverlay").hidden = false;
  }
  function closeConfirm() {
    $("#confirmOverlay").hidden = true;
    state.confirmAction = null;
  }
  function initConfirmDialog() {
    $("#confirmCancelBtn").addEventListener("click", closeConfirm);
    $("#confirmOverlay").addEventListener("click", (e) => {
      if (e.target.id === "confirmOverlay") closeConfirm();
    });
    $("#confirmOkBtn").addEventListener("click", async () => {
      const action = state.confirmAction;
      closeConfirm();
      if (action) await action();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Clients view                                                       */
  /* ------------------------------------------------------------------ */
  function populateClientsMonthFilter() {
    const sel = $("#clientFilterMonth");
    if (!sel) return;
    const months = availableMonthsFrom(state.payments);
    populateMonthSelect(sel, months, state.clientsFilterMonth);
  }

  async function renderClientsView() {
    populateClientsMonthFilter();
    try {
      state.clients = await Api.getClients(state.clientsFilterMonth);
    } catch (err) {
      showToast(err.message, "error");
      state.clients = buildClientsFromPayments(
        state.clientsFilterMonth === "all"
          ? state.payments
          : state.payments.filter((p) => monthKeyOf(p.date) === state.clientsFilterMonth)
      );
    }
    renderClientGrid(state.clients);
  }

  function renderClientGrid(clients) {
    const grid = $("#clientGrid");
    if (!clients.length) {
      grid.innerHTML = `<p style="color:var(--text-muted);">No clients yet.</p>`;
      return;
    }
    grid.innerHTML = clients.map((c, idx) => `
      <div class="client-card" data-index="${idx}">
        <div class="client-card-head">
          <div class="client-avatar">${initials(c.clientName)}</div>
          <div>
            <h4>${escapeHtml(c.clientName)}</h4>
            <span>${escapeHtml(c.businessName || c.mobile || "")}</span>
          </div>
        </div>
        <div class="client-stats">
          <div>
            <span class="cs-label">Business</span>
            <span class="cs-value">${fmtMoney(c.totalBusiness)}</span>
          </div>
          <div>
            <span class="cs-label">Received</span>
            <span class="cs-value">${fmtMoney(c.totalReceived)}</span>
          </div>
          <div>
            <span class="cs-label">Pending</span>
            <span class="cs-value">${fmtMoney(c.totalPending)}</span>
          </div>
        </div>
      </div>
    `).join("");

    $$(".client-card").forEach((card) => {
      card.addEventListener("click", () => openClientDetail(clients[Number(card.dataset.index)]));
    });
  }

  function initClientSearch() {
    $("#clientSearch").addEventListener("input", debounce(() => {
      const search = $("#clientSearch").value.toLowerCase();
      const filtered = state.clients.filter((c) =>
        [c.clientName, c.mobile, c.businessName, c.instagram].some((f) => (f || "").toLowerCase().includes(search))
      );
      renderClientGrid(filtered);
    }, 200));

    $("#clientFilterMonth").addEventListener("change", async () => {
      state.clientsFilterMonth = $("#clientFilterMonth").value;
      await renderClientsView();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Leads view                                                         */
  /* ------------------------------------------------------------------ */
  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function leadSourceBadge(source) {
    return `<span class="badge-source">${escapeHtml(source || "—")}</span>`;
  }

  async function refreshLeadsData() {
    state.leads = await Api.getLeads();
    renderLeadsView();
  }

  function getFilteredSortedLeads() {
    const search = ($("#leadSearch").value || "").toLowerCase();
    const status = $("#leadFilterStatus").value;
    const source = $("#leadFilterSource").value;
    const sort = $("#sortLeads").value;

    let list = state.leads.filter((l) => {
      const matchesSearch = !search ||
        [l.name, l.mobile, l.businessName, l.instagram, l.source, l.status]
          .some((f) => (f || "").toString().toLowerCase().includes(search));
      const matchesStatus = !status || l.status === status;
      const matchesSource = !source || l.source === source;
      return matchesSearch && matchesStatus && matchesSource;
    });

    list.sort((a, b) => {
      switch (sort) {
        case "date-desc": return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        case "date-asc": return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
        case "value-desc": return (Number(b.expectedValue) || 0) - (Number(a.expectedValue) || 0);
        case "name-asc": return (a.name || "").localeCompare(b.name || "");
        case "followup-asc":
        default: {
          // Leads without a next follow-up date sort to the end.
          if (!a.nextFollowup && !b.nextFollowup) return 0;
          if (!a.nextFollowup) return 1;
          if (!b.nextFollowup) return -1;
          return new Date(a.nextFollowup) - new Date(b.nextFollowup);
        }
      }
    });

    return list;
  }

  function renderLeadStats() {
    const leads = state.leads;
    const total = leads.length;
    const inProgress = leads.filter((l) => ["Contacted", "Follow-up", "Interested"].includes(l.status)).length;
    const today = todayStr();
    const followupToday = leads.filter((l) => l.nextFollowup && l.nextFollowup <= today && !["Converted", "Lost"].includes(l.status)).length;
    const converted = leads.filter((l) => l.status === "Converted").length;
    const lost = leads.filter((l) => l.status === "Lost").length;
    const pipelineValue = leads
      .filter((l) => !["Converted", "Lost"].includes(l.status))
      .reduce((sum, l) => sum + (Number(l.expectedValue) || 0), 0);

    $("#leadStatTotal").textContent = total;
    $("#leadStatInProgress").textContent = inProgress;
    $("#leadStatFollowupToday").textContent = followupToday;
    $("#leadStatConverted").textContent = converted;
    $("#leadStatLost").textContent = lost;
    $("#leadStatPipelineValue").textContent = fmtMoney(pipelineValue);
  }

  function renderLeadsView() {
    renderLeadStats();
    const list = getFilteredSortedLeads();
    const tbody = $("#leadsTable tbody");
    const empty = $("#leadsEmpty");

    if (!list.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    const today = todayStr();

    tbody.innerHTML = list.map((l) => {
      const overdue = l.nextFollowup && l.nextFollowup <= today && !["Converted", "Lost"].includes(l.status);
      return `
      <tr data-id="${l.id}">
        <td>${escapeHtml(l.name)}</td>
        <td>${escapeHtml(l.businessName || "—")}</td>
        <td>${escapeHtml(l.mobile)}</td>
        <td>${leadSourceBadge(l.source)}</td>
        <td><span class="badge ${escapeHtml(l.status)}">${escapeHtml(l.status)}</span></td>
        <td>${fmtMoney(l.expectedValue)}</td>
        <td style="${overdue ? "color:var(--danger); font-weight:600;" : ""}">${l.nextFollowup ? fmtDate(l.nextFollowup) : "—"}</td>
        <td class="row-actions">
          <button class="icon-btn view-lead-btn" data-id="${l.id}" title="View"><i class="fa-solid fa-eye"></i></button>
          <button class="icon-btn edit-lead-btn" data-id="${l.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          ${!["Converted", "Lost"].includes(l.status) ? `<button class="icon-btn convert-lead-btn" data-id="${l.id}" title="Convert to Client"><i class="fa-solid fa-right-left"></i></button>` : ""}
          <button class="icon-btn delete-lead-btn" data-id="${l.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
    }).join("");

    $$(".view-lead-btn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lead = state.leads.find((l) => l.id === btn.dataset.id);
      if (lead) openLeadDrawer(lead);
    }));

    $$(".edit-lead-btn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openLeadModal(btn.dataset.id);
    }));

    $$(".convert-lead-btn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lead = state.leads.find((l) => l.id === btn.dataset.id);
      if (!lead) return;
      openConfirmConvert(lead);
    }));

    $$(".delete-lead-btn").forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lead = state.leads.find((l) => l.id === btn.dataset.id);
      openConfirm(
        "Delete this lead?",
        `This will permanently delete the lead record for ${lead ? escapeHtml(lead.name) : "this contact"}.`,
        async () => {
          try {
            await Api.deleteLead(btn.dataset.id);
            await refreshLeadsData();
            showToast("Lead deleted", "success");
          } catch (err) {
            showToast(err.message, "error");
          }
        }
      );
    }));
  }

  // Re-uses the shared confirm dialog to ask before turning a lead into a
  // paying client (creates a payment record + wipes the lead from the list).
  function openConfirmConvert(lead) {
    openConfirm(
      "Convert to Client?",
      `This will move "${escapeHtml(lead.name)}" into Clients/Payments using their expected value as the opening amount, and remove them from Leads.`,
      async () => {
        try {
          await Api.convertLead(lead.id, {
            totalAmount: Number(lead.expectedValue) || 0,
            category: state.categories[0] || "Other"
          });
          await refreshLeadsData();
          await refreshPaymentsData();
          showToast(`${lead.name} converted to client`, "success");
        } catch (err) {
          showToast(err.message, "error");
        }
      }
    );
  }

  function openLeadModal(id = null) {
    state.editingLeadId = id;
    const overlay = $("#leadModalOverlay");
    const title = $("#leadModalTitle");
    const form = $("#leadForm");
    form.reset();

    if (id) {
      const lead = state.leads.find((l) => l.id === id);
      if (!lead) return;
      title.textContent = "Edit Lead";
      $("#leadId").value = lead.id;
      $("#lName").value = lead.name || "";
      $("#lMobile").value = lead.mobile || "";
      $("#lBusinessName").value = lead.businessName || "";
      $("#lInstagram").value = lead.instagram || "";
      $("#lSource").value = lead.source || "Instagram DM";
      $("#lStatus").value = lead.status || "New";
      $("#lExpectedValue").value = lead.expectedValue || 0;
      $("#lNextFollowup").value = lead.nextFollowup || "";
      $("#lNotes").value = lead.notes || "";
    } else {
      title.textContent = "Add Lead";
      $("#leadId").value = "";
      $("#lSource").value = "Instagram DM";
      $("#lStatus").value = "New";
      $("#lExpectedValue").value = 0;
    }

    overlay.hidden = false;
  }

  function closeLeadModal() {
    $("#leadModalOverlay").hidden = true;
    state.editingLeadId = null;
  }

  function collectLeadFormData() {
    return {
      name: $("#lName").value.trim(),
      mobile: $("#lMobile").value.trim(),
      businessName: $("#lBusinessName").value.trim(),
      instagram: $("#lInstagram").value.trim(),
      source: $("#lSource").value,
      status: $("#lStatus").value,
      expectedValue: Number($("#lExpectedValue").value) || 0,
      nextFollowup: $("#lNextFollowup").value,
      notes: $("#lNotes").value.trim()
    };
  }

  function initLeadModal() {
    $("#addLeadBtn").addEventListener("click", () => openLeadModal());
    $("#closeLeadModal").addEventListener("click", closeLeadModal);
    $("#cancelLeadBtn").addEventListener("click", closeLeadModal);
    $("#leadModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "leadModalOverlay") closeLeadModal();
    });

    $("#leadForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = collectLeadFormData();
      const id = $("#leadId").value;
      try {
        if (id) {
          await Api.updateLead(id, data);
          showToast("Lead updated", "success");
        } else {
          await Api.createLead(data);
          showToast("Lead added", "success");
        }
        closeLeadModal();
        await refreshLeadsData();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  function openLeadDrawer(lead) {
    $("#leadDrawerTitle").textContent = lead.name;
    const body = $("#leadDrawerBody");
    body.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="client-stats" style="border-top:none; padding-top:0;">
          <div><span class="cs-label">Status</span><span class="cs-value"><span class="badge ${escapeHtml(lead.status)}">${escapeHtml(lead.status)}</span></span></div>
          <div><span class="cs-label">Expected Value</span><span class="cs-value">${fmtMoney(lead.expectedValue)}</span></div>
          <div><span class="cs-label">Next Follow-up</span><span class="cs-value">${lead.nextFollowup ? fmtDate(lead.nextFollowup) : "—"}</span></div>
        </div>
        <p style="font-size:13px; color:var(--text-muted);">
          <b>Mobile:</b> ${escapeHtml(lead.mobile || "—")}<br/>
          <b>Business:</b> ${escapeHtml(lead.businessName || "—")}<br/>
          <b>Instagram:</b> ${escapeHtml(lead.instagram || "—")}<br/>
          <b>Source:</b> ${leadSourceBadge(lead.source)}<br/>
          <b>Added:</b> ${lead.createdAt ? fmtDate(lead.createdAt) : "—"}
        </p>
        <div>
          <b style="font-size:13px;">Notes</b>
          <p style="font-size:13px; color:var(--text-muted); white-space:pre-wrap;">${escapeHtml(lead.notes || "No notes yet.")}</p>
        </div>
      </div>
    `;
    $("#leadDrawerOverlay").hidden = false;
  }

  function initLeadDrawer() {
    $("#closeLeadDrawer").addEventListener("click", () => { $("#leadDrawerOverlay").hidden = true; });
    $("#leadDrawerOverlay").addEventListener("click", (e) => {
      if (e.target.id === "leadDrawerOverlay") $("#leadDrawerOverlay").hidden = true;
    });
  }

  function initLeadsToolbar() {
    $("#leadSearch").addEventListener("input", debounce(renderLeadsView, 200));
    $("#leadFilterStatus").addEventListener("change", renderLeadsView);
    $("#leadFilterSource").addEventListener("change", renderLeadsView);
    $("#sortLeads").addEventListener("change", renderLeadsView);
  }

  /* ------------------------------------------------------------------ */
  /* Reports view                                                       */
  /* ------------------------------------------------------------------ */
  async function runReport() {
    const type = $("#reportType").value;
    const status = $("#reportStatus").value;
    try {
      const [report, topClients] = await Promise.all([Api.getReport(type, status), Api.getTopClients()]);
      renderReportTable(report, type);
      renderReportSummary(report);
      renderTopClientsTable(topClients);
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  function formatReportKey(key, type) {
    switch (type) {
      case "monthly": return monthShortLabel(key);
      case "daily": return fmtDate(key);
      case "weekly": return `Week of ${fmtDate(key)}`;
      case "yearly": return key;
      default: return key || "—";
    }
  }

  function renderReportSummary(rows) {
    const totals = rows.reduce((acc, r) => {
      acc.count += r.count;
      acc.totalAmount += r.totalAmount;
      acc.paidAmount += r.paidAmount;
      acc.pendingAmount += r.pendingAmount;
      return acc;
    }, { count: 0, totalAmount: 0, paidAmount: 0, pendingAmount: 0 });

    $("#reportStatRecords").textContent = totals.count;
    $("#reportStatTotal").textContent = fmtMoney(totals.totalAmount);
    $("#reportStatPaid").textContent = fmtMoney(totals.paidAmount);
    $("#reportStatPending").textContent = fmtMoney(totals.pendingAmount);
  }

  function renderReportTable(rows, type) {
    const tbody = $("#reportTable tbody");
    tbody.innerHTML = rows.map((r) => `
      <tr>
        <td>${escapeHtml(formatReportKey(r.key, type))}</td>
        <td>${r.count}</td>
        <td>${fmtMoney(r.totalAmount)}</td>
        <td class="amount-paid">${fmtMoney(r.paidAmount)}</td>
        <td class="amount-pending">${fmtMoney(r.pendingAmount)}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No data for this report.</td></tr>`;

    const tfoot = $("#reportTable tfoot");
    if (tfoot) {
      if (!rows.length) {
        tfoot.innerHTML = "";
      } else {
        const totals = rows.reduce((acc, r) => {
          acc.count += r.count;
          acc.totalAmount += r.totalAmount;
          acc.paidAmount += r.paidAmount;
          acc.pendingAmount += r.pendingAmount;
          return acc;
        }, { count: 0, totalAmount: 0, paidAmount: 0, pendingAmount: 0 });
        tfoot.innerHTML = `
          <tr>
            <td>Total</td>
            <td>${totals.count}</td>
            <td>${fmtMoney(totals.totalAmount)}</td>
            <td class="amount-paid">${fmtMoney(totals.paidAmount)}</td>
            <td class="amount-pending">${fmtMoney(totals.pendingAmount)}</td>
          </tr>
        `;
      }
    }
  }

  function renderTopClientsTable(clients) {
    const tbody = $("#topClientsTable tbody");
    tbody.innerHTML = clients.map((c, idx) => `
      <tr>
        <td><span class="rank-chip">${idx + 1}</span></td>
        <td>${escapeHtml(c.clientName)}</td>
        <td>${escapeHtml(c.businessName || "—")}</td>
        <td>${fmtMoney(c.totalBusiness)}</td>
        <td class="amount-pending">${fmtMoney(c.totalPending)}</td>
      </tr>
    `).join("") || `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No clients yet.</td></tr>`;
  }

  function initReportsToolbar() {
    $("#runReportBtn").addEventListener("click", runReport);
  }

  /* ------------------------------------------------------------------ */
  /* Export (Excel / CSV / PDF / Invoice)                                */
  /* ------------------------------------------------------------------ */
  function populateInvoiceSelect() {
    const select = $("#invoicePaymentSelect");
    select.innerHTML = state.payments.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.clientName)} — ${fmtMoney(p.totalAmount)} (${fmtDate(p.date)})</option>`
    ).join("") || `<option value="">No payments available</option>`;
  }

  function buildMonthlyProfitSummary() {
    const incomeByMonth = {};
    state.payments.forEach((p) => {
      const key = monthKeyOf(p.date);
      if (!key) return;
      incomeByMonth[key] = (incomeByMonth[key] || 0) + (Number(p.paidAmount) || 0);
    });
    const expensesByMonth = {};
    state.expenses.forEach((e) => {
      const key = monthKeyOf(e.date);
      if (!key) return;
      expensesByMonth[key] = (expensesByMonth[key] || 0) + (Number(e.amount) || 0);
    });
    const months = Array.from(new Set([...Object.keys(incomeByMonth), ...Object.keys(expensesByMonth)])).sort();
    return months.map((key) => {
      const income = incomeByMonth[key] || 0;
      const expenses = expensesByMonth[key] || 0;
      return { month: key, label: monthShortLabel(key), income, expenses, profit: income - expenses };
    });
  }

  function initExportButtons() {
    $("#exportExcelBtn").addEventListener("click", () => {
      if (typeof XLSX === "undefined") { showToast("Excel library not loaded", "error"); return; }
      const paymentRows = state.payments.map((p) => ({
        Client: p.clientName, Mobile: p.mobile, Business: p.businessName, Instagram: p.instagram,
        Category: p.category, Date: p.date, Total: p.totalAmount, Paid: p.paidAmount,
        Pending: p.pendingAmount, Status: p.status, "Due Date": p.dueDate, Notes: p.notes
      }));
      const expenseRows = state.expenses.map((e) => ({
        Date: e.date, Category: e.category, Amount: e.amount, Notes: e.notes
      }));
      const profitRows = buildMonthlyProfitSummary().map((r) => ({
        Month: r.label, Income: r.income, Expenses: r.expenses, Profit: r.profit
      }));

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(paymentRows), "Payments");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenseRows), "Expenses");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(profitRows), "Monthly Profit");
      XLSX.writeFile(wb, `payflow-export-${Date.now()}.xlsx`);
      showToast("Excel file downloaded", "success");
    });

    $("#exportCsvBtn").addEventListener("click", () => {
      window.location.href = "/api/export/csv";
    });

    $("#exportExpensesCsvBtn").addEventListener("click", () => {
      window.location.href = "/api/export/expenses-csv";
    });

    $("#exportPdfBtn").addEventListener("click", () => {
      if (typeof window.jspdf === "undefined") { showToast("PDF library not loaded", "error"); return; }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      // jsPDF's built-in fonts (Helvetica) don't include the ₹ glyph, so it
      // renders as a broken/garbled character. Use a plain "Rs." prefix in
      // PDFs specifically so every amount is fully readable.
      const pdfMoney = (n) => "Rs. " + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });

      const companyName = state.settings.companyName || "PayFlow";
      const addFooter = () => {
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber} of ${pageCount}`, 14, doc.internal.pageSize.height - 8);
      };

      // ---- Page 1: Payments -------------------------------------------------
      doc.setFontSize(16);
      doc.setTextColor(20);
      doc.text(`${companyName} — Payments Summary`, 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Generated on ${new Date().toLocaleString("en-IN")} • ${state.payments.length} records`, 14, 22);
      doc.setTextColor(20);

      const paymentBody = state.payments.map((p) => [
        p.clientName || "—",
        p.businessName || "—",
        p.category || "—",
        pdfMoney(p.totalAmount),
        pdfMoney(p.paidAmount),
        pdfMoney(p.pendingAmount),
        p.status || "—",
        fmtDate(p.date)
      ]);
      const paymentTotals = state.payments.reduce((acc, p) => {
        acc.total += Number(p.totalAmount) || 0;
        acc.paid += Number(p.paidAmount) || 0;
        acc.pending += Number(p.pendingAmount) || 0;
        return acc;
      }, { total: 0, paid: 0, pending: 0 });

      doc.autoTable({
        head: [["Client", "Business", "Category", "Total", "Paid", "Pending", "Status", "Date"]],
        body: paymentBody,
        foot: [["", "", "Totals", pdfMoney(paymentTotals.total), pdfMoney(paymentTotals.paid), pdfMoney(paymentTotals.pending), "", ""]],
        startY: 28,
        styles: { fontSize: 8.5, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [18, 117, 108], textColor: 255, fontStyle: "bold" },
        footStyles: { fillColor: [230, 240, 239], textColor: 20, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 250, 250] },
        columnStyles: {
          0: { cellWidth: 26 }, 1: { cellWidth: 26 }, 2: { cellWidth: 18 },
          3: { cellWidth: 20 }, 4: { cellWidth: 20 }, 5: { cellWidth: 20 },
          6: { cellWidth: 16 }, 7: { cellWidth: 20 }
        },
        margin: { left: 14, right: 14 },
        didDrawPage: addFooter
      });

      // ---- Page 2: Expenses ---------------------------------------------
      doc.addPage();
      doc.setFontSize(16);
      doc.setTextColor(20);
      doc.text(`${companyName} — Expenses Summary`, 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`${state.expenses.length} records`, 14, 22);
      doc.setTextColor(20);

      const expenseBody = state.expenses
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .map((e) => [fmtDate(e.date), e.category || "—", pdfMoney(e.amount), e.notes || "—"]);
      const expenseTotal = state.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

      doc.autoTable({
        head: [["Date", "Category", "Amount", "Notes"]],
        body: expenseBody,
        foot: [["", "Total", pdfMoney(expenseTotal), ""]],
        startY: 28,
        styles: { fontSize: 8.5, cellPadding: 4, overflow: "linebreak" },
        headStyles: { fillColor: [200, 70, 80], textColor: 255, fontStyle: "bold" },
        footStyles: { fillColor: [250, 232, 233], textColor: 20, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 248, 248] },
        margin: { left: 14, right: 14 },
        didDrawPage: addFooter
      });

      // ---- Page 3: Monthly Profit ----------------------------------------
      doc.addPage();
      doc.setFontSize(16);
      doc.setTextColor(20);
      doc.text(`${companyName} — Monthly Profit`, 14, 16);
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Income minus Expenses, by month`, 14, 22);
      doc.setTextColor(20);

      const profitRows = buildMonthlyProfitSummary();
      const profitBody = profitRows.map((r) => [r.label, pdfMoney(r.income), pdfMoney(r.expenses), pdfMoney(r.profit)]);

      doc.autoTable({
        head: [["Month", "Income", "Expenses", "Profit"]],
        body: profitBody,
        startY: 28,
        styles: { fontSize: 9, cellPadding: 5 },
        headStyles: { fillColor: [18, 117, 108], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [247, 250, 250] },
        didParseCell: (hookData) => {
          if (hookData.section === "body" && hookData.column.index === 3) {
            const profit = profitRows[hookData.row.index]?.profit ?? 0;
            hookData.cell.styles.textColor = profit >= 0 ? [20, 140, 100] : [200, 60, 60];
            hookData.cell.styles.fontStyle = "bold";
          }
        },
        margin: { left: 14, right: 14 },
        didDrawPage: addFooter
      });

      doc.save(`payflow-export-${Date.now()}.pdf`);
      showToast("PDF downloaded", "success");
    });

    $("#printInvoiceBtn").addEventListener("click", () => {
      const id = $("#invoicePaymentSelect").value;
      const payment = state.payments.find((p) => p.id === id);
      if (!payment) { showToast("Select a payment first", "error"); return; }
      renderInvoiceAndPrint(payment);
    });
  }

  function renderInvoiceAndPrint(p) {
    const area = $("#invoicePrintArea");
    area.innerHTML = `
      <div style="font-family:sans-serif; max-width:700px; margin:0 auto;">
        <h1 style="margin-bottom:4px;">${escapeHtml(state.settings.companyName || "PayFlow")}</h1>
        <p style="color:#555; margin-bottom:24px;">Invoice — ${escapeHtml(p.id)}</p>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr><td style="padding:6px 0;"><b>Client</b></td><td>${escapeHtml(p.clientName)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Mobile</b></td><td>${escapeHtml(p.mobile)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Business</b></td><td>${escapeHtml(p.businessName)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Category</b></td><td>${escapeHtml(p.category)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Work Details</b></td><td>${escapeHtml(p.workDetails)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Date</b></td><td>${fmtDate(p.date)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Total Amount</b></td><td>${fmtMoney(p.totalAmount)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Paid Amount</b></td><td>${fmtMoney(p.paidAmount)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Pending Amount</b></td><td>${fmtMoney(p.pendingAmount)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Status</b></td><td>${escapeHtml(p.status)}</td></tr>
          <tr><td style="padding:6px 0;"><b>Notes</b></td><td>${escapeHtml(p.notes)}</td></tr>
        </table>
      </div>
    `;
    window.print();
  }

  /* ------------------------------------------------------------------ */
  /* Expenses view                                                       */
  /* ------------------------------------------------------------------ */
  function populateExpenseCategorySelect() {
    const sel = $("#eCategory");
    if (!sel) return;
    sel.innerHTML = state.expenseCategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }

  function populateExpensesMonthFilter() {
    const sel = $("#expenseFilterMonth");
    if (!sel) return;
    const months = availableMonthsFrom(state.expenses);
    populateMonthSelect(sel, months, state.expensesFilterMonth);
  }

  function getFilteredExpenses() {
    const month = state.expensesFilterMonth;
    let list = state.expenses.filter((e) => month === "all" || monthKeyOf(e.date) === month);
    list.sort((a, b) => new Date(b.date) - new Date(a.date));
    return list;
  }

  function renderExpenseStats() {
    const todayStr = new Date().toISOString().slice(0, 10);
    const thisMonth = currentMonthKey();

    const spentToday = state.expenses
      .filter((e) => e.date === todayStr)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const spentThisMonth = state.expenses
      .filter((e) => monthKeyOf(e.date) === thisMonth)
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
    const spentAllTime = state.expenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    $("#expenseStatToday").textContent = fmtMoney(spentToday);
    $("#expenseStatMonth").textContent = fmtMoney(spentThisMonth);
    $("#expenseStatAllTime").textContent = fmtMoney(spentAllTime);
    const label = $("#expenseStatMonthLabel");
    if (label) label.textContent = `Spent in ${monthShortLabel(thisMonth)}`;
  }

  function renderExpensesTable() {
    const list = getFilteredExpenses();
    const tbody = $("#expensesTable tbody");
    const empty = $("#expensesEmpty");

    if (!list.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    tbody.innerHTML = list.map((e) => `
      <tr>
        <td>${fmtDate(e.date)}</td>
        <td><span class="badge-cat">${escapeHtml(e.category)}</span></td>
        <td class="amount-pending">${fmtMoney(e.amount)}</td>
        <td>${escapeHtml(e.notes || "—")}</td>
        <td class="row-actions">
          <button class="icon-btn edit-expense-btn" data-id="${e.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn delete-expense-btn" data-id="${e.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `).join("");

    $$(".edit-expense-btn").forEach((btn) => btn.addEventListener("click", () => openExpenseModal(btn.dataset.id)));
    $$(".delete-expense-btn").forEach((btn) => btn.addEventListener("click", () => {
      const expense = state.expenses.find((e) => e.id === btn.dataset.id);
      openConfirm(
        "Delete this expense?",
        `This will permanently delete the ${expense ? escapeHtml(expense.category) : "expense"} record.`,
        async () => {
          try {
            await Api.deleteExpense(btn.dataset.id);
            await refreshExpensesData();
            showToast("Expense deleted", "success");
          } catch (err) {
            showToast(err.message, "error");
          }
        }
      );
    }));
  }

  function renderExpenseChart() {
    if (typeof Chart === "undefined") return;
    const ctx = $("#expenseCategoryChart");
    if (!ctx) return;

    const totals = {};
    getFilteredExpenses().forEach((e) => {
      totals[e.category] = (totals[e.category] || 0) + (Number(e.amount) || 0);
    });
    const entries = Object.entries(totals);

    if (state.charts.expenseCategory) state.charts.expenseCategory.destroy();
    state.charts.expenseCategory = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: entries.map(([k]) => k),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: ["#e0555c", "#dd9a2e", "#7c6cf0", "#3b82f6", "#17a072", "#e15b7c", "#12756c", "#a7b7b5"],
          borderWidth: 0
        }]
      },
      options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } } }, cutout: "60%" }
    });
  }

  function renderExpensesView() {
    populateExpensesMonthFilter();
    populateExpenseCategorySelect();
    renderExpenseStats();
    renderExpensesTable();
    renderExpenseChart();
  }

  async function refreshExpensesData() {
    state.expenses = await Api.getExpenses();
    renderExpensesView();
    if (state.dashboard) renderDashboard();
  }

  function openExpenseModal(id = null) {
    state.editingExpenseId = id;
    const overlay = $("#expenseModalOverlay");
    const title = $("#expenseModalTitle");
    const form = $("#expenseForm");
    form.reset();
    populateExpenseCategorySelect();

    if (id) {
      const expense = state.expenses.find((e) => e.id === id);
      if (!expense) return;
      title.textContent = "Edit Expense";
      $("#expenseId").value = expense.id;
      $("#eDate").value = expense.date || "";
      $("#eCategory").value = expense.category || "";
      $("#eAmount").value = expense.amount || 0;
      $("#eNotes").value = expense.notes || "";
    } else {
      title.textContent = "Add Expense";
      $("#expenseId").value = "";
      $("#eDate").value = new Date().toISOString().slice(0, 10);
    }
    overlay.hidden = false;
  }

  function closeExpenseModal() {
    $("#expenseModalOverlay").hidden = true;
    state.editingExpenseId = null;
  }

  function initExpenseModal() {
    $("#addExpenseBtn").addEventListener("click", () => openExpenseModal());
    $("#closeExpenseModal").addEventListener("click", closeExpenseModal);
    $("#cancelExpenseBtn").addEventListener("click", closeExpenseModal);
    $("#expenseModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "expenseModalOverlay") closeExpenseModal();
    });

    $("#expenseForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const data = {
        date: $("#eDate").value,
        category: $("#eCategory").value,
        amount: Number($("#eAmount").value) || 0,
        notes: $("#eNotes").value.trim()
      };
      const id = $("#expenseId").value;
      try {
        if (id) {
          await Api.updateExpense(id, data);
          showToast("Expense updated", "success");
        } else {
          await Api.createExpense(data);
          showToast("Expense added", "success");
        }
        closeExpenseModal();
        await refreshExpensesData();
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  function initExpensesToolbar() {
    $("#expenseFilterMonth").addEventListener("change", () => {
      state.expensesFilterMonth = $("#expenseFilterMonth").value;
      renderExpensesTable();
      renderExpenseChart();
    });
    $("#exportExpensesQuickBtn").addEventListener("click", () => {
      window.location.href = "/api/export/expenses-csv";
    });
  }

  /* ------------------------------------------------------------------ */
  /* Backup / Restore                                                    */
  /* ------------------------------------------------------------------ */
  function initBackupRestore() {
    $("#backupBtn").addEventListener("click", () => {
      window.location.href = "/api/backup";
    });

    $("#restoreBtn").addEventListener("click", () => {
      $("#restoreFileInput").click();
    });

    $("#restoreFileInput").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("backupFile", file);
      try {
        const res = await fetch("/api/restore", { method: "POST", body: formData });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Restore failed");
        showToast(body.message || "Backup restored", "success");
        await loadInitialData();
      } catch (err) {
        showToast(err.message, "error");
      } finally {
        e.target.value = "";
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Settings view                                                       */
  /* ------------------------------------------------------------------ */
  function renderSettingsForm() {
    $("#settingCompanyName").value = state.settings.companyName || "";
    $("#settingCurrency").value = state.settings.currency || "₹";
    $$(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.theme === state.settings.themeColor));
    $("#lightModeBtn").classList.toggle("active", !state.settings.darkMode);
    $("#darkModeBtn").classList.toggle("active", !!state.settings.darkMode);
  }

  function initSettingsView() {
    $$(".swatch").forEach((swatch) => {
      swatch.addEventListener("click", async () => {
        state.settings.themeColor = swatch.dataset.theme;
        applySettingsToUI();
        renderSettingsForm();
        try { await Api.updateSettings({ themeColor: state.settings.themeColor }); }
        catch (err) { showToast(err.message, "error"); }
      });
    });

    $("#lightModeBtn").addEventListener("click", async () => {
      state.settings.darkMode = false;
      applySettingsToUI();
      renderSettingsForm();
      try { await Api.updateSettings({ darkMode: false }); } catch (err) { showToast(err.message, "error"); }
    });
    $("#darkModeBtn").addEventListener("click", async () => {
      state.settings.darkMode = true;
      applySettingsToUI();
      renderSettingsForm();
      try { await Api.updateSettings({ darkMode: true }); } catch (err) { showToast(err.message, "error"); }
    });

    $("#settingsForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        state.settings = await Api.updateSettings({
          companyName: $("#settingCompanyName").value.trim(),
          currency: $("#settingCurrency").value.trim() || "₹"
        });
        applySettingsToUI();
        renderGreeting();
        showToast("Settings saved", "success");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Dashboard month filter                                              */
  /* ------------------------------------------------------------------ */
  function initDashboardFilter() {
    const sel = $("#dashboardMonthFilter");
    if (!sel) return;
    sel.addEventListener("change", async () => {
      state.dashboardMonth = sel.value;
      try {
        await loadDashboard();
      } catch (err) {
        showToast("Failed to load dashboard: " + err.message, "error");
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Global search (topbar) — jumps to Payments view & filters           */
  /* ------------------------------------------------------------------ */
  function initGlobalSearch() {
    $("#globalSearch").addEventListener("input", debounce(() => {
      const value = $("#globalSearch").value;
      if (!value) return;
      window.location.hash = "payments";
      setActiveView("payments");
      $("#paymentSearch").value = value;
      renderPaymentsView();
    }, 300));
  }

  /* ------------------------------------------------------------------ */
  /* Profile chip / logout                                              */
  /* ------------------------------------------------------------------ */
  function initProfileAndLogout() {
    $("#logoutBtn").addEventListener("click", () => {
      showToast("Logged out (demo only — no auth backend).", "info");
    });
  }

  /* ------------------------------------------------------------------ */
  /* Initial data load                                                   */
  /* ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------ */
  /* Client Detail Page                                                  */
  /* Opened by clicking a client card. Three tabs:                       */
  /*   Overview  -> One-Time + Package counts, Lifetime Revenue,         */
  /*                Outstanding — 100% computed, nothing stored here.    */
  /*   One-Time  -> this client's Jobs (Active/On Hold/Completed lists)  */
  /*   Package   -> this client's Packages, either "Post & Reel" or      */
  /*                "Management" type                                   */
  /* ------------------------------------------------------------------ */

  function clientKeyOf(client) {
    return (client.mobile || client.clientName || "").toString().trim();
  }

  function pkgStatusClass(status) {
    return status || "Pending";
  }

  function jobStatusClass(status) {
    // Reuse the same visual language as package status badges
    return status === "Completed" ? "Completed" : (status === "On Hold" ? "On Hold" : "Active");
  }

  async function openClientDetail(client) {
    state.currentClient = client;
    state.currentClientKey = clientKeyOf(client);
    state.clientDetailTab = "overview";
    state.oneTimeFilter = "Active";
    state.packageFilter = "Active";

    window.location.hash = "clientDetail";
    setActiveView("clientDetail");

    renderClientDetailHeader();
    switchClientTab("overview");
    await refreshClientDetail();
  }

  function renderClientDetailHeader() {
    const client = state.currentClient;
    if (!client) return;
    const profileKey = state.currentClientKey;
    const profile = state.clientProfiles[profileKey] || { location: "", folderPath: "" };

    $("#cdAvatar").textContent = initials(client.clientName);
    $("#cdName").textContent = client.clientName;
    $("#cdMeta").innerHTML = [
      client.mobile ? `<span><i class="fa-solid fa-phone"></i> ${escapeHtml(client.mobile)}</span>` : "",
      client.businessName ? `<span><i class="fa-solid fa-briefcase"></i> ${escapeHtml(client.businessName)}</span>` : "",
      client.instagram ? `<span><i class="fa-brands fa-instagram"></i> ${escapeHtml(client.instagram)}</span>` : ""
    ].filter(Boolean).join("");

    $("#cdLocation").value = profile.location || "";
    $("#cdFolderPath").value = profile.folderPath || "";
  }

  async function refreshClientDetail() {
    if (!state.currentClientKey) return;
    const key = state.currentClientKey;

    const [overview, packages] = await Promise.all([
      Api.getClientOverview(key),
      Api.getPackages(`client=${encodeURIComponent(key)}`)
    ]);

    state.clientOverview = overview;
    state.clientJobs = state.payments.filter((p) => (p.mobile || p.clientName || "").toString().trim() === key);
    state.clientPackages = packages;

    $("#cdLifetimeRevenue").textContent = fmtMoney(overview.lifetimeRevenue);
    $("#cdOutstanding").textContent = fmtMoney(overview.outstanding);

    renderClientOverviewTab();
    renderOneTimeTab();
    renderClientPackageTab();
  }

  function switchClientTab(tab) {
    state.clientDetailTab = tab;
    $$("#clientDetailTabs .tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".client-tab-panel").forEach((p) => p.classList.toggle("active", p.id === `clientTab-${tab}`));
  }

  // --- Tab 1: Overview ---

  function statBlock(counts) {
    return `
      <div class="stat-mini-grid">
        <div class="stat-mini"><span class="sm-value">${counts.total}</span><span class="sm-label">Total</span></div>
        <div class="stat-mini"><span class="sm-value">${counts.active}</span><span class="sm-label">Active</span></div>
        <div class="stat-mini"><span class="sm-value">${counts.onHold}</span><span class="sm-label">On Hold</span></div>
        <div class="stat-mini"><span class="sm-value">${counts.completed}</span><span class="sm-label">Completed</span></div>
        <div class="stat-mini"><span class="sm-value">${counts.paymentPending}</span><span class="sm-label">Payment Pending</span></div>
      </div>`;
  }

  function renderClientOverviewTab() {
    const o = state.clientOverview;
    if (!o) return;
    $("#cdOverviewOneTime").innerHTML = statBlock(o.oneTime);
    $("#cdOverviewPackage").innerHTML = statBlock(o.packages);
  }

  // --- Tab 2: One-Time Jobs ---

  function renderOneTimeTab() {
    const list = (state.clientJobs || []).filter((j) => (j.jobStatus || "Active") === state.oneTimeFilter);
    const container = $("#oneTimeJobsList");
    if (!container) return;

    $$("#oneTimeFilterTabs button").forEach((b) => b.classList.toggle("active", b.dataset.filter === state.oneTimeFilter));

    if (!list.length) {
      container.innerHTML = `<p class="muted">No ${escapeHtml(state.oneTimeFilter)} jobs.</p>`;
      return;
    }

    container.innerHTML = list.map((j) => {
      const progress = j.progress && j.progress.total > 0
        ? `<span class="job-progress">${j.progress.done}/${j.progress.total} done</span>`
        : "";
      return `
      <div class="job-row card" data-id="${j.id}">
        <div class="job-row-main">
          <h4>${escapeHtml(j.jobName || j.workDetails || "Untitled Job")}</h4>
          <p class="muted">${escapeHtml(j.category || "")} • Start ${fmtDate(j.date)}${j.dueDate ? ` • Due ${fmtDate(j.dueDate)}` : ""}</p>
          ${progress}
        </div>
        <div class="job-row-side">
          <span class="badge ${jobStatusClass(j.jobStatus)}">${escapeHtml(j.jobStatus || "Active")}</span>
          <span class="job-amount">${fmtMoney(j.paidAmount)} / ${fmtMoney(j.totalAmount)}</span>
          <span class="badge ${statusClass(j.status)}">${escapeHtml(j.status)}</span>
        </div>
      </div>`;
    }).join("");

    $$("#oneTimeJobsList .job-row").forEach((row) => {
      row.addEventListener("click", () => openJobModal(row.dataset.id));
    });
  }

  // --- Job Add/Edit Modal ---

  function recalcJobPending() {
    const total = Number($("#jbTotalAmount").value) || 0;
    const paid = Number($("#jbPaidAmount").value) || 0;
    const pending = Math.max(total - paid, 0);
    $("#jbPendingAmount").value = pending.toFixed(2);
    const status = paid <= 0 ? "Pending" : (paid >= total && total > 0 ? "Paid" : "Advance");
    $("#jbPaymentStatusBadge").textContent = status;
    $("#jbPaymentStatusBadge").className = `badge ${statusClass(status)}`;
  }

  function toggleJobProgressFields() {
    const on = $("#jbHasProgress").checked;
    $("#jbProgressFields").hidden = !on;
  }

  function openJobModal(id = null) {
    state.editingJobId = id;
    const form = $("#jobForm");
    form.reset();
    $("#deleteJobBtn").hidden = !id;

    if (id) {
      const job = state.clientJobs.find((j) => j.id === id);
      if (!job) return;
      $("#jobModalTitle").textContent = "Edit One-Time Job";
      $("#jbName").value = job.jobName || job.workDetails || "";
      $("#jbCategory").value = job.category || "";
      $("#jbStartDate").value = job.date || "";
      $("#jbDueDate").value = job.dueDate || "";
      $("#jbStatus").value = job.jobStatus || "Active";
      $("#jbTotalAmount").value = job.totalAmount || 0;
      $("#jbPaidAmount").value = job.paidAmount || 0;
      $("#jbNotes").value = job.notes || "";
      const hasProgress = job.progress && job.progress.total > 0;
      $("#jbHasProgress").checked = !!hasProgress;
      $("#jbProgressTotal").value = hasProgress ? job.progress.total : "";
      $("#jbProgressDone").value = hasProgress ? job.progress.done : "";
    } else {
      $("#jobModalTitle").textContent = "Add One-Time Job";
      $("#jbStartDate").value = new Date().toISOString().slice(0, 10);
      $("#jbStatus").value = "Active";
      $("#jbTotalAmount").value = 0;
      $("#jbPaidAmount").value = 0;
      $("#jbHasProgress").checked = false;
    }
    toggleJobProgressFields();
    recalcJobPending();
    populateCategorySelects();
    $("#jbCategory").value = id ? (state.clientJobs.find((j) => j.id === id)?.category || "") : $("#jbCategory").value;
    $("#jobModalOverlay").hidden = false;
  }

  function closeJobModal() {
    $("#jobModalOverlay").hidden = true;
    state.editingJobId = null;
  }

  async function refreshJobsAfterSave() {
    state.payments = await Api.getPayments();
    await refreshClientDetail();
  }

  function initJobModal() {
    $("#addJobBtn")?.addEventListener("click", () => openJobModal());
    $("#closeJobModal")?.addEventListener("click", closeJobModal);
    $("#cancelJobBtn")?.addEventListener("click", closeJobModal);
    $("#jobModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "jobModalOverlay") closeJobModal();
    });
    $("#jbTotalAmount")?.addEventListener("input", recalcJobPending);
    $("#jbPaidAmount")?.addEventListener("input", recalcJobPending);
    $("#jbHasProgress")?.addEventListener("change", toggleJobProgressFields);

    $("#deleteJobBtn")?.addEventListener("click", () => {
      if (!state.editingJobId) return;
      openConfirm("Delete Job", "Delete this one-time job? This cannot be undone.", async () => {
        try {
          await Api.deletePayment(state.editingJobId);
          showToast("Job deleted", "success");
          closeJobModal();
          await refreshJobsAfterSave();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      });
    });

    $("#jobForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const client = state.currentClient;
      const hasProgress = $("#jbHasProgress").checked;
      const payload = {
        clientName: client.clientName,
        mobile: client.mobile,
        businessName: client.businessName,
        instagram: client.instagram,
        jobName: $("#jbName").value.trim(),
        category: $("#jbCategory").value,
        date: $("#jbStartDate").value,
        dueDate: $("#jbDueDate").value,
        jobStatus: $("#jbStatus").value,
        totalAmount: Number($("#jbTotalAmount").value) || 0,
        paidAmount: Number($("#jbPaidAmount").value) || 0,
        notes: $("#jbNotes").value.trim(),
        progress: hasProgress
          ? { total: Number($("#jbProgressTotal").value) || 0, done: Number($("#jbProgressDone").value) || 0 }
          : { total: 0, done: 0 }
      };
      try {
        if (state.editingJobId) {
          await Api.updatePayment(state.editingJobId, payload);
          showToast("Job updated", "success");
        } else {
          await Api.createPayment(payload);
          showToast("Job added", "success");
        }
        closeJobModal();
        await refreshJobsAfterSave();
      } catch (err) {
        showToast("Failed to save job: " + err.message, "error");
      }
    });
  }

  // --- Tab 3: Packages (Post & Reel / Management) ---

  function packageProgressLabel(pkg) {
    const p = pkg.progress || { done: 0, total: 0, percent: 0 };
    return `${p.done}/${p.total} (${p.percent}%)`;
  }

  function renderClientPackageTab() {
    const list = (state.clientPackages || []).filter((p) => p.status === state.packageFilter);
    const container = $("#clientPackageList");
    if (!container) return;

    $$("#packageFilterTabs button").forEach((b) => b.classList.toggle("active", b.dataset.filter === state.packageFilter));

    if (!list.length) {
      container.innerHTML = `<p class="muted">No ${escapeHtml(state.packageFilter)} packages.</p>`;
      return;
    }

    container.innerHTML = list.map((pk) => `
      <div class="package-row card" data-id="${pk.id}">
        <div class="package-row-main">
          <h4>${escapeHtml(pk.name)} <span class="type-tag">${pk.packageType === "management" ? "Management" : "Post & Reel"}</span></h4>
          <p class="muted">Start ${fmtDate(pk.startDate)}${pk.endDate ? ` • End ${fmtDate(pk.endDate)}` : ""}</p>
          <p class="muted">Progress: ${packageProgressLabel(pk)}</p>
        </div>
        <div class="package-row-side">
          <span class="badge ${pkgStatusClass(pk.status)}">${escapeHtml(pk.status)}</span>
          <span class="job-amount">${fmtMoney(pk.paidAmount)} / ${fmtMoney(pk.totalAmount)}</span>
          <span class="badge ${statusClass(pk.paymentStatus)}">${escapeHtml(pk.paymentStatus)}</span>
        </div>
      </div>
    `).join("");

    $$("#clientPackageList .package-row").forEach((row) => {
      row.addEventListener("click", () => openPackageModal(row.dataset.id));
    });
  }

  // --- Package type picker (asked first, per spec) ---

  function openPackageTypeModal() {
    $("#packageTypeModalOverlay").hidden = false;
  }
  function closePackageTypeModal() {
    $("#packageTypeModalOverlay").hidden = true;
  }

  // --- Package Add/Edit Modal ---

  let tempPlatformRows = [];

  function blankPlatformRow(name) {
    return { name, status: "Active", posts: { total: 0, done: 0 }, reels: { total: 0, done: 0 }, stories: { total: 0, done: 0 } };
  }

  function renderPlatformRows() {
    const container = $("#pkPlatformRows");
    if (!container) return;
    if (!tempPlatformRows.length) {
      container.innerHTML = `<p class="muted">No platforms added yet.</p>`;
      return;
    }
    container.innerHTML = tempPlatformRows.map((row, idx) => `
      <div class="platform-row" data-idx="${idx}">
        <div class="platform-row-head">
          <strong>${escapeHtml(row.name)}</strong>
          <select data-field="status" data-idx="${idx}">
            <option value="Active" ${row.status === "Active" ? "selected" : ""}>Active</option>
            <option value="Inactive" ${row.status === "Inactive" ? "selected" : ""}>Inactive</option>
          </select>
          <button type="button" class="btn-icon remove-platform-btn" data-idx="${idx}" title="Remove"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="platform-row-counters">
          <label>Posts <input type="number" min="0" data-field="posts.total" data-idx="${idx}" value="${row.posts.total}" placeholder="Total" />
            <input type="number" min="0" data-field="posts.done" data-idx="${idx}" value="${row.posts.done}" placeholder="Done" /></label>
          <label>Reels <input type="number" min="0" data-field="reels.total" data-idx="${idx}" value="${row.reels.total}" placeholder="Total" />
            <input type="number" min="0" data-field="reels.done" data-idx="${idx}" value="${row.reels.done}" placeholder="Done" /></label>
          <label>Stories <input type="number" min="0" data-field="stories.total" data-idx="${idx}" value="${row.stories.total}" placeholder="Total" />
            <input type="number" min="0" data-field="stories.done" data-idx="${idx}" value="${row.stories.done}" placeholder="Done" /></label>
        </div>
      </div>
    `).join("");

    $$("#pkPlatformRows [data-field]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const idx = Number(e.target.dataset.idx);
        const field = e.target.dataset.field;
        const value = e.target.tagName === "SELECT" ? e.target.value : (Number(e.target.value) || 0);
        if (field.includes(".")) {
          const [group, key] = field.split(".");
          tempPlatformRows[idx][group][key] = value;
        } else {
          tempPlatformRows[idx][field] = value;
        }
      });
    });
    $$(".remove-platform-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        tempPlatformRows.splice(Number(btn.dataset.idx), 1);
        renderPlatformRows();
      });
    });
  }

  function populatePlatformAddSelect() {
    const sel = $("#pkAddPlatformSelect");
    if (!sel) return;
    sel.innerHTML = `<option value="">— Select Platform —</option>` +
      state.platformOptions.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("");
  }

  function renderPackagePaymentHistory(pkg) {
    const container = $("#pkPaymentHistoryList");
    if (!container) return;
    const history = pkg && pkg.paymentHistory ? pkg.paymentHistory : [];
    if (!history.length) {
      container.innerHTML = `<p class="muted">No payments recorded yet.</p>`;
      return;
    }
    container.innerHTML = history.map((h) => `
      <div class="ph-row" data-entry-id="${h.id}">
        <span>${fmtDate(h.date)}</span>
        <span>${fmtMoney(h.amount)}</span>
        <span class="badge">${escapeHtml(h.type)}</span>
        <span class="muted">${escapeHtml(h.note || "")}</span>
        <button type="button" class="btn-icon remove-ph-btn" data-entry-id="${h.id}"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join("");

    $$(".remove-ph-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await Api.deletePackagePayment(state.editingPackageId, btn.dataset.entryId);
          const fresh = await Api.getPackage(state.editingPackageId);
          renderPackagePaymentHistory(fresh);
          syncPackagePaymentSummary(fresh);
          await refreshClientDetail();
        } catch (err) {
          showToast("Failed to remove payment: " + err.message, "error");
        }
      });
    });
  }

  function syncPackagePaymentSummary(pkg) {
    $("#pkPaidSoFar").textContent = fmtMoney(pkg.paidAmount);
    $("#pkPendingSoFar").textContent = fmtMoney(pkg.pendingAmount);
    $("#pkPaymentStatusBadge").textContent = pkg.paymentStatus;
    $("#pkPaymentStatusBadge").className = `badge ${statusClass(pkg.paymentStatus)}`;
  }

  function openPackageModal(id = null) {
    state.editingPackageId = id;
    const form = $("#packageForm");
    form.reset();
    tempPlatformRows = [];
    populatePlatformAddSelect();
    $("#deletePackageBtn").hidden = !id;
    $("#pkPaymentHistorySection").hidden = !id;

    if (id) {
      const pkg = (state.clientPackages || []).find((p) => p.id === id);
      if (!pkg) return;
      state.newPackageType = pkg.packageType;
      $("#packageModalTitle").textContent = "Edit Package";
      $("#pkName").value = pkg.name || "";
      $("#pkStartDate").value = pkg.startDate || "";
      $("#pkEndDate").value = pkg.endDate || "";
      $("#pkStatus").value = pkg.status || "Active";
      $("#pkTotalAmount").value = pkg.totalAmount || 0;
      $("#pkPaymentDueDate").value = pkg.paymentDueDate || "";
      $("#pkNotes").value = pkg.notes || "";

      if (pkg.packageType === "management") {
        tempPlatformRows = (pkg.platforms || []).map((r) => ({ ...r }));
      } else {
        $("#pkPostsTotal").value = pkg.posts?.total || 0;
        $("#pkPostsDone").value = pkg.posts?.done || 0;
        $("#pkReelsTotal").value = pkg.reels?.total || 0;
        $("#pkReelsDone").value = pkg.reels?.done || 0;
        $("#pkStoriesTotal").value = pkg.stories?.total || 0;
        $("#pkStoriesDone").value = pkg.stories?.done || 0;
      }
      renderPackagePaymentHistory(pkg);
      syncPackagePaymentSummary(pkg);
    } else {
      $("#packageModalTitle").textContent = state.newPackageType === "management" ? "Add Management Package" : "Add Post & Reel Package";
      $("#pkStartDate").value = new Date().toISOString().slice(0, 10);
      $("#pkStatus").value = "Active";
      $("#pkTotalAmount").value = 0;
    }

    $("#pkPostReelFields").hidden = state.newPackageType !== "postReel";
    $("#pkManagementFields").hidden = state.newPackageType !== "management";
    renderPlatformRows();
    $("#packageModalOverlay").hidden = false;
  }

  function closePackageModal() {
    $("#packageModalOverlay").hidden = true;
    $("#packageForm").reset();
    state.editingPackageId = null;
    tempPlatformRows = [];
  }

  async function refreshPackagesAfterSave() {
    await refreshClientDetail();
  }

  function initPackageTypeModal() {
    $("#addPackageBtn")?.addEventListener("click", openPackageTypeModal);
    $("#closePackageTypeModal")?.addEventListener("click", closePackageTypeModal);
    $("#packageTypeModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "packageTypeModalOverlay") closePackageTypeModal();
    });
    $("#choosePostReelBtn")?.addEventListener("click", () => {
      state.newPackageType = "postReel";
      closePackageTypeModal();
      openPackageModal();
    });
    $("#chooseManagementBtn")?.addEventListener("click", () => {
      state.newPackageType = "management";
      closePackageTypeModal();
      openPackageModal();
    });
  }

  function initPackageModal() {
    $("#closePackageModal")?.addEventListener("click", closePackageModal);
    $("#cancelPackageBtn")?.addEventListener("click", closePackageModal);
    $("#packageModalOverlay")?.addEventListener("click", (e) => {
      if (e.target.id === "packageModalOverlay") closePackageModal();
    });

    $("#pkAddPlatformBtn")?.addEventListener("click", () => {
      const sel = $("#pkAddPlatformSelect");
      const name = sel.value;
      if (!name) return;
      if (tempPlatformRows.some((r) => r.name === name)) {
        showToast("Platform already added", "info");
        return;
      }
      tempPlatformRows.push(blankPlatformRow(name));
      renderPlatformRows();
      sel.value = "";
    });

    $("#savePaymentEntryBtn")?.addEventListener("click", async () => {
      if (!state.editingPackageId) {
        showToast("Save the package first, then add payments", "info");
        return;
      }
      const amount = Number($("#phAmount").value) || 0;
      if (amount <= 0) {
        showToast("Enter a valid amount", "error");
        return;
      }
      try {
        const updated = await Api.addPackagePayment(state.editingPackageId, {
          date: $("#phDate").value,
          amount,
          type: $("#phType").value,
          note: $("#phNote").value.trim()
        });
        $("#phAmount").value = "";
        $("#phNote").value = "";
        renderPackagePaymentHistory(updated);
        syncPackagePaymentSummary(updated);
        await refreshClientDetail();
        showToast("Payment added", "success");
      } catch (err) {
        showToast("Failed to add payment: " + err.message, "error");
      }
    });

    $("#deletePackageBtn")?.addEventListener("click", () => {
      if (!state.editingPackageId) return;
      openConfirm("Delete Package", "Delete this package? This cannot be undone.", async () => {
        try {
          await Api.deletePackage(state.editingPackageId);
          showToast("Package deleted", "success");
          closePackageModal();
          await refreshPackagesAfterSave();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      });
    });

    $("#packageForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const client = state.currentClient;
      const payload = {
        clientName: client.clientName,
        clientMobile: client.mobile,
        name: $("#pkName").value.trim(),
        packageType: state.newPackageType,
        startDate: $("#pkStartDate").value,
        endDate: $("#pkEndDate").value,
        status: $("#pkStatus").value,
        totalAmount: Number($("#pkTotalAmount").value) || 0,
        paymentDueDate: $("#pkPaymentDueDate").value,
        notes: $("#pkNotes").value.trim()
      };
      if (state.newPackageType === "management") {
        payload.platforms = tempPlatformRows;
      } else {
        payload.posts = { total: Number($("#pkPostsTotal").value) || 0, done: Number($("#pkPostsDone").value) || 0 };
        payload.reels = { total: Number($("#pkReelsTotal").value) || 0, done: Number($("#pkReelsDone").value) || 0 };
        payload.stories = { total: Number($("#pkStoriesTotal").value) || 0, done: Number($("#pkStoriesDone").value) || 0 };
      }
      try {
        if (state.editingPackageId) {
          await Api.updatePackage(state.editingPackageId, payload);
          showToast("Package updated", "success");
        } else {
          await Api.createPackage(payload);
          showToast("Package added", "success");
        }
        closePackageModal();
        await refreshPackagesAfterSave();
      } catch (err) {
        showToast("Failed to save package: " + err.message, "error");
      }
    });
  }

  // --- Wiring for the Client Detail page shell (back button + tabs) ---

  function initClientDetail() {
    $("#backToClientsBtn")?.addEventListener("click", () => {
      window.location.hash = "clients";
      setActiveView("clients");
    });

    $$("#clientDetailTabs .tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchClientTab(btn.dataset.tab));
    });

    $$("#oneTimeFilterTabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.oneTimeFilter = btn.dataset.filter;
        renderOneTimeTab();
      });
    });

    $$("#packageFilterTabs button").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.packageFilter = btn.dataset.filter;
        renderClientPackageTab();
      });
    });

    $("#cdSaveProfileBtn")?.addEventListener("click", async () => {
      try {
        const updated = await Api.updateClientProfile(state.currentClientKey, {
          location: $("#cdLocation").value.trim(),
          folderPath: $("#cdFolderPath").value.trim()
        });
        state.clientProfiles[state.currentClientKey] = updated;
        showToast("Client profile saved", "success");
      } catch (err) {
        showToast("Failed to save: " + err.message, "error");
      }
    });
  }

  async function loadInitialData() {
    const [payments, categories, settings, expenses, expenseCategories, leads, platformOptions, clientProfiles] = await Promise.all([
      Api.getPayments(),
      Api.getCategories(),
      Api.getSettings(),
      Api.getExpenses(),
      Api.getExpenseCategories(),
      Api.getLeads(),
      Api.getPlatformOptions(),
      Api.getClientProfiles()
    ]);
    state.payments = payments;
    state.categories = categories;
    state.settings = settings;
    state.expenses = expenses;
    state.expenseCategories = expenseCategories;
    state.leads = leads;
    state.platformOptions = platformOptions;
    state.clientProfiles = clientProfiles;

    applySettingsToUI();
    renderGreeting();
    populateCategorySelects();

    await loadDashboard();
    await loadOverview();

    const view = (window.location.hash || "#overview").slice(1);
    setActiveView(view);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", async () => {
    initNavigation();
    initSidebarToggle();
    initDarkModeToggle();
    initNotifications();
    initPaymentsToolbar();
    initPaymentModal();
    initConfirmDialog();
    initClientSearch();
    initClientDetail();
    initJobModal();
    initPackageTypeModal();
    initPackageModal();
    initLeadModal();
    initLeadDrawer();
    initLeadsToolbar();
    initCategoryForm();
    initReportsToolbar();
    initExpenseModal();
    initExpensesToolbar();
    initExportButtons();
    initBackupRestore();
    initSettingsView();
    initGlobalSearch();
    initProfileAndLogout();
    initDashboardFilter();
    initOverviewFilter();

    try {
      await loadInitialData();
    } catch (err) {
      showToast("Failed to load data: " + err.message, "error");
    } finally {
      const loader = $("#appLoader");
      if (loader) loader.style.display = "none";
    }
  });
})();
