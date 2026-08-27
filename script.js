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
    settings: { companyName: "My Agency", currency: "₹", themeColor: "orange", darkMode: true },
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

    // One-Time Jobs / Packages (per open Client)
    oneTimeJobs: [],
    packages: [],
    platformOptions: [],
    clientProfiles: {},
    currentClientKey: null,     // mobile||name of the client currently open in the drawer
    currentClient: null,        // full client object currently open
    activeClientTab: "overview",
    jobFilterStatus: "",
    packageFilterStatus: "",
    editingJobId: null,
    editingPackageId: null,
    pendingPackageType: null,   // set by the type-picker before opening the right modal
    mgSelectedPlatforms: [],    // [{name, active, posts, reels, stories}] while editing a Management package

    // Global "Add" flow (from the Clients main tab, before any client is open)
    addFlowTarget: null,        // null | "onetime" | "postreel" | "management" — what to open once a client is picked
    addFlowFromGlobal: false    // true while the package type picker was opened from the global Add flow
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

    getOneTimeJobs: (clientKey) => api(`/api/one-time-jobs${clientKey ? `?client=${encodeURIComponent(clientKey)}` : ""}`),
    getOneTimeJob: (id) => api(`/api/one-time-jobs/${id}`),
    createOneTimeJob: (data) => api("/api/one-time-jobs", { method: "POST", body: JSON.stringify(data) }),
    updateOneTimeJob: (id, data) => api(`/api/one-time-jobs/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteOneTimeJob: (id) => api(`/api/one-time-jobs/${id}`, { method: "DELETE" }),
    addOneTimeJobPayment: (id, data) => api(`/api/one-time-jobs/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
    deleteOneTimeJobPayment: (id, entryId) => api(`/api/one-time-jobs/${id}/payments/${entryId}`, { method: "DELETE" }),

    getPackages: (clientKey) => api(`/api/packages${clientKey ? `?client=${encodeURIComponent(clientKey)}` : ""}`),
    getPackage: (id) => api(`/api/packages/${id}`),
    createPackage: (data) => api("/api/packages", { method: "POST", body: JSON.stringify(data) }),
    updatePackage: (id, data) => api(`/api/packages/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deletePackage: (id) => api(`/api/packages/${id}`, { method: "DELETE" }),
    addPackagePayment: (id, data) => api(`/api/packages/${id}/payments`, { method: "POST", body: JSON.stringify(data) }),
    deletePackagePayment: (id, entryId) => api(`/api/packages/${id}/payments/${entryId}`, { method: "DELETE" }),

    getPlatformOptions: () => api("/api/platform-options"),
    getClientOverview: (key) => api(`/api/clients/${encodeURIComponent(key)}/overview`),

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
    if (status === "Partial") return "Partial";
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
    if (view === "packages") renderPackagesView();

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
      const counts = d.statusCounts || { Paid: 0, Partial: 0, Pending: 0 };
      if (state.charts.pie) state.charts.pie.destroy();
      state.charts.pie = new Chart(pieCtx, {
        type: "doughnut",
        data: {
          labels: ["Paid", "Partial", "Pending"],
          datasets: [{
            data: [counts.Paid, counts.Partial, counts.Pending],
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
    // One-Time Job category select (same source list as payment categories)
    const jCat = $("#jCategory");
    if (jCat) {
      jCat.innerHTML = state.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
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
    else $("#fStatus").value = "Partial";
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
      card.addEventListener("click", () => openClientDrawer(clients[Number(card.dataset.index)]));
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

  async function openClientDrawer(client) {
    state.currentClient = client;
    state.currentClientKey = client.mobile || client.clientName;
    state.activeClientTab = "overview";
    state.jobFilterStatus = "";
    state.packageFilterStatus = "";

    $("#clientDrawerTitle").textContent = client.clientName;
    renderClientDrawerHeader(client);

    $$(".client-tabs .tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === "overview"));
    $("#tabPanel-overview").hidden = false;
    $("#tabPanel-onetime").hidden = true;
    $("#tabPanel-packages").hidden = true;

    $("#clientDrawerOverlay").hidden = false;

    await refreshClientTabData();
  }

  function renderClientDrawerHeader(client) {
    const profileKey = client.mobile || client.clientName;
    const profile = state.clientProfiles[profileKey] || { location: "", folderPath: "" };
    $("#clientDrawerHeader").innerHTML = `
      <div class="client-stats" style="border-top:none; padding-top:0; margin-bottom:14px;">
        <div><span class="cs-label">Business</span><span class="cs-value">${fmtMoney(client.totalBusiness)}</span></div>
        <div><span class="cs-label">Received</span><span class="cs-value">${fmtMoney(client.totalReceived)}</span></div>
        <div><span class="cs-label">Pending</span><span class="cs-value">${fmtMoney(client.totalPending)}</span></div>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
        <b>Mobile:</b> ${escapeHtml(client.mobile || "—")} &nbsp;·&nbsp;
        <b>Instagram:</b> ${escapeHtml(client.instagram || "—")}
      </p>
      <div class="drawer-section" style="margin-bottom:14px;">
        <div class="drawer-section-head"><h3>Location &amp; File Folder</h3></div>
        <div class="inline-form" style="flex-direction:column; align-items:stretch;">
          <input type="text" id="cpLocation" placeholder="Client location (city/area)" value="${escapeHtml(profile.location)}" />
          <input type="text" id="cpFolderPath" placeholder="e.g. D:\\Clients\\${escapeHtml(client.clientName)}\\" value="${escapeHtml(profile.folderPath)}" />
          <button type="button" class="btn btn-primary btn-sm" id="saveClientProfileBtn" style="align-self:flex-start;">
            <i class="fa-solid fa-check"></i> Save
          </button>
        </div>
      </div>
    `;
    $("#saveClientProfileBtn")?.addEventListener("click", async () => {
      try {
        const updated = await Api.updateClientProfile(profileKey, {
          location: $("#cpLocation").value.trim(),
          folderPath: $("#cpFolderPath").value.trim()
        });
        state.clientProfiles[profileKey] = updated;
        showToast("Client profile saved", "success");
      } catch (err) {
        showToast("Failed to save: " + err.message, "error");
      }
    });
  }

  async function refreshClientsGridIfVisible() {
    const view = $("#view-clients");
    if (view && view.classList.contains("active")) {
      await renderClientsView();
    }
  }

  async function refreshClientTabData() {
    const key = state.currentClientKey;
    if (!key) return;
    const [jobs, packages, overview] = await Promise.all([
      Api.getOneTimeJobs(key),
      Api.getPackages(key),
      Api.getClientOverview(key)
    ]);
    state.oneTimeJobs = jobs;
    state.packages = packages;
    $("#cOneTimeCount").textContent = jobs.length ? `(${jobs.length})` : "";
    $("#cPackageCount").textContent = packages.length ? `(${packages.length})` : "";
    renderClientOverviewTab(overview);
    renderOneTimeTab();
    renderPackagesTab();
  }

  function renderClientOverviewTab(overview) {
    const o = overview.oneTime;
    const p = overview.packages;
    $("#tabPanel-overview").innerHTML = `
      <div class="drawer-section">
        <h3>One-Time Jobs</h3>
        <div class="stat-mini-grid">
          <div><b>${o.total}</b><span>Total</span></div>
          <div><b>${o.Active || 0}</b><span>Active</span></div>
          <div><b>${o["In Progress"] || 0}</b><span>In Progress</span></div>
          <div><b>${o["On Hold"] || 0}</b><span>On Hold</span></div>
          <div><b>${o.Completed || 0}</b><span>Completed</span></div>
          <div><b class="danger-num">${o.paymentPending}</b><span>Payment Pending</span></div>
        </div>
      </div>
      <div class="drawer-section">
        <h3>Packages</h3>
        <div class="stat-mini-grid">
          <div><b>${p.total}</b><span>Total</span></div>
          <div><b>${p.Active || 0}</b><span>Active</span></div>
          <div><b>${p["On Hold"] || 0}</b><span>On Hold</span></div>
          <div><b>${p.Completed || 0}</b><span>Completed</span></div>
          <div><b class="danger-num">${p.paymentPending}</b><span>Payment Pending</span></div>
        </div>
      </div>
    `;
  }

  // --- One-Time tab ---

  function filteredJobs() {
    return state.oneTimeJobs.filter((j) => !state.jobFilterStatus || j.status === state.jobFilterStatus);
  }

  function renderOneTimeTab() {
    const list = filteredJobs();
    const container = $("#oneTimeJobList");
    if (!list.length) {
      container.innerHTML = `<p class="muted" style="padding:20px 0;">No one-time jobs${state.jobFilterStatus ? ` with status "${escapeHtml(state.jobFilterStatus)}"` : ""} yet.</p>`;
      return;
    }
    container.innerHTML = list.map((j) => `
      <div class="mini-project-row" data-id="${j.id}">
        <div class="mini-project-main">
          <b>${escapeHtml(j.name)}</b>
          <span class="muted">${escapeHtml(j.category || "—")}${j.totalUnits ? ` · ${j.doneUnits}/${j.totalUnits} done` : ""}</span>
        </div>
        <div class="mini-project-meta">
          <span class="muted"><i class="fa-regular fa-calendar"></i> ${fmtDate(j.startDate)} → ${j.dueDate ? fmtDate(j.dueDate) : "—"}</span>
          <span class="badge ${pkgStatusClass(j.status)}">${escapeHtml(j.status)}</span>
          <span class="badge ${pkgStatusClass(j.paymentStatus)}">${escapeHtml(j.paymentStatus)}</span>
          <button class="icon-btn-sm edit-job-btn"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn-sm delete-job-btn"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`).join("");

    $$(".mini-project-row", container).forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".edit-job-btn") || e.target.closest(".delete-job-btn")) return;
        const job = state.oneTimeJobs.find((x) => x.id === row.dataset.id);
        openOneTimeJobModal(job);
      });
    });
    $$(".edit-job-btn", container).forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const job = state.oneTimeJobs.find((x) => x.id === btn.closest(".mini-project-row").dataset.id);
      openOneTimeJobModal(job);
    }));
    $$(".delete-job-btn", container).forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.closest(".mini-project-row").dataset.id;
      openConfirm("Delete One-Time Job", "Are you sure you want to delete this job?", async () => {
        try {
          await Api.deleteOneTimeJob(id);
          showToast("Job deleted", "success");
          await refreshClientTabData();
          state.payments = await Api.getPayments();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      });
    }));
  }

  function initJobFilterChips() {
    $$("#jobFilterChips .chip").forEach((chip) => chip.addEventListener("click", () => {
      $$("#jobFilterChips .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.jobFilterStatus = chip.dataset.status;
      renderOneTimeTab();
    }));
  }

  // --- Package tab ---

  function filteredClientPackages() {
    return state.packages.filter((p) => !state.packageFilterStatus || p.status === state.packageFilterStatus);
  }

  function renderPackagesTab() {
    const list = filteredClientPackages();
    const container = $("#clientPackageList");
    if (!list.length) {
      container.innerHTML = `<p class="muted" style="padding:20px 0;">No packages${state.packageFilterStatus ? ` with status "${escapeHtml(state.packageFilterStatus)}"` : ""} yet.</p>`;
      return;
    }
    container.innerHTML = list.map((pk) => {
      const progress = pk.progress || {};
      const progressText = pk.type === "Management"
        ? `${progress.posts || 0} Posts · ${progress.reels || 0} Reels · ${progress.stories || 0} Stories`
        : `${progress.percent || 0}% (${progress.done || 0}/${progress.total || 0})`;
      return `
      <div class="mini-project-row" data-id="${pk.id}" data-type="${pk.type}">
        <div class="mini-project-main">
          <b>${escapeHtml(pk.name)}</b>
          <span class="muted">${pk.type === "Management" ? "Management" : "Post &amp; Reel"} · ${progressText}</span>
        </div>
        <div class="mini-project-meta">
          <span class="muted"><i class="fa-regular fa-calendar"></i> ${fmtDate(pk.startDate)} → ${pk.endDate ? fmtDate(pk.endDate) : "—"}</span>
          <span class="badge ${pkgStatusClass(pk.status)}">${escapeHtml(pk.status)}</span>
          <span class="badge ${pkgStatusClass(pk.paymentStatus)}">${escapeHtml(pk.paymentStatus)}</span>
          <button class="icon-btn-sm edit-pkg-btn"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn-sm delete-pkg-btn"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
    }).join("");

    $$(".mini-project-row", container).forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest(".edit-pkg-btn") || e.target.closest(".delete-pkg-btn")) return;
        openPackageEditByType(row.dataset.id, row.dataset.type);
      });
    });
    $$(".edit-pkg-btn", container).forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const row = btn.closest(".mini-project-row");
      openPackageEditByType(row.dataset.id, row.dataset.type);
    }));
    $$(".delete-pkg-btn", container).forEach((btn) => btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.closest(".mini-project-row").dataset.id;
      openConfirm("Delete Package", "Are you sure you want to delete this package?", async () => {
        try {
          await Api.deletePackage(id);
          showToast("Package deleted", "success");
          await refreshClientTabData();
          state.payments = await Api.getPayments();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      });
    }));
  }

  function openPackageEditByType(id, type) {
    const pkg = state.packages.find((p) => p.id === id);
    if (!pkg) return;
    if (type === "Management") openManagementPackageModal(pkg);
    else openPostReelPackageModal(pkg);
  }

  function initPackageFilterChips() {
    $$("#packageFilterChips .chip").forEach((chip) => chip.addEventListener("click", () => {
      $$("#packageFilterChips .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.packageFilterStatus = chip.dataset.status;
      renderPackagesTab();
    }));
  }

  function initClientDrawer() {
    $("#closeClientDrawer").addEventListener("click", () => {
      $("#clientDrawerOverlay").hidden = true;
      state.currentClientKey = null;
      state.currentClient = null;
    });
    $("#clientDrawerOverlay").addEventListener("click", (e) => {
      if (e.target.id === "clientDrawerOverlay") {
        $("#clientDrawerOverlay").hidden = true;
        state.currentClientKey = null;
        state.currentClient = null;
      }
    });
    $$(".client-tabs .tab-btn").forEach((btn) => btn.addEventListener("click", () => {
      $$(".client-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      state.activeClientTab = tab;
      $("#tabPanel-overview").hidden = tab !== "overview";
      $("#tabPanel-onetime").hidden = tab !== "onetime";
      $("#tabPanel-packages").hidden = tab !== "packages";
    }));
    initJobFilterChips();
    initPackageFilterChips();

    $("#addOneTimeJobBtn").addEventListener("click", () => openOneTimeJobModal(null));
    $("#addPackageBtn").addEventListener("click", () => openPackageTypePicker());
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
  /* One-Time Jobs / Packages (inside the Client Detail Drawer)          */
  /* ------------------------------------------------------------------ */

  function pkgStatusClass(status) {
    return (status || "Pending").replace(/\s+/g, "");
  }

  function paymentSummaryHtml(entity) {
    return `
      <div><span class="cs-label">Total</span><span class="cs-value">${fmtMoney(entity.totalAmount)}</span></div>
      <div><span class="cs-label">Paid</span><span class="cs-value" style="color:var(--success);">${fmtMoney(entity.paidAmount)}</span></div>
      <div><span class="cs-label">Pending</span><span class="cs-value" style="color:var(--danger);">${fmtMoney(entity.pendingAmount)}</span></div>
      <div><span class="cs-label">Status</span><span class="cs-value"><span class="badge ${pkgStatusClass(entity.paymentStatus)}">${escapeHtml(entity.paymentStatus)}</span></span></div>
    `;
  }

  function paymentHistoryRowsHtml(entity, deleteBtnClass) {
    const history = entity.paymentHistory || [];
    if (!history.length) return `<tr><td colspan="5" class="muted">No payments recorded yet.</td></tr>`;
    return history.map((h) => `
      <tr>
        <td>${fmtDate(h.date)}</td>
        <td>${fmtMoney(h.amount)}</td>
        <td>${escapeHtml(h.type)}</td>
        <td>${escapeHtml(h.note || "—")}</td>
        <td><button type="button" class="icon-btn-sm ${deleteBtnClass}" data-id="${h.id}"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`).join("");
  }

  /* ---------------- One-Time Job modal ---------------- */

  function openOneTimeJobModal(job = null) {
    state.editingJobId = job ? job.id : null;
    $("#oneTimeJobModalTitle").textContent = job ? "Edit One-Time Job" : "Add One-Time Job";
    $("#jobId").value = job ? job.id : "";
    $("#jClientName").value = state.currentClient.clientName;
    $("#jClientMobile").value = state.currentClient.mobile || "";
    $("#jName").value = job ? job.name : "";
    $("#jCategory").value = job ? job.category : (state.categories[0] || "");
    $("#jPriority").value = job ? job.priority : "Medium";
    $("#jStartDate").value = job ? job.startDate : new Date().toISOString().slice(0, 10);
    $("#jDueDate").value = job ? job.dueDate : "";
    $("#jStatus").value = job ? job.status : "Active";
    $("#jTotalUnits").value = job ? job.totalUnits : 0;
    $("#jDoneUnits").value = job ? job.doneUnits : 0;
    $("#jTotalAmount").value = job ? job.totalAmount : "";
    $("#jNotes").value = job ? job.notes : "";

    const paymentSection = $("#jPaymentSection");
    if (job) {
      paymentSection.hidden = false;
      $("#jPaymentSummary").innerHTML = paymentSummaryHtml(job);
      $("#jPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(job, "delete-job-payment-btn");
      $$(".delete-job-payment-btn").forEach((btn) => btn.addEventListener("click", async () => {
        try {
          const updated = await Api.deleteOneTimeJobPayment(job.id, btn.dataset.id);
          Object.assign(job, updated);
          $("#jPaymentSummary").innerHTML = paymentSummaryHtml(job);
          $("#jPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(job, "delete-job-payment-btn");
          state.payments = await Api.getPayments();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      }));
    } else {
      paymentSection.hidden = true;
    }
    $("#jPaymentAddForm").hidden = true;

    $("#oneTimeJobModalOverlay").hidden = false;
  }

  function closeOneTimeJobModal() {
    $("#oneTimeJobModalOverlay").hidden = true;
    $("#oneTimeJobForm").reset();
    state.editingJobId = null;
  }

  function initOneTimeJobModal() {
    $("#closeOneTimeJobModal").addEventListener("click", closeOneTimeJobModal);
    $("#cancelOneTimeJobBtn").addEventListener("click", closeOneTimeJobModal);
    $("#oneTimeJobModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "oneTimeJobModalOverlay") closeOneTimeJobModal();
    });

    $("#jAddPaymentBtn").addEventListener("click", () => {
      $("#jphDate").value = new Date().toISOString().slice(0, 10);
      $("#jPaymentAddForm").hidden = !$("#jPaymentAddForm").hidden;
    });
    $("#jSavePaymentBtn").addEventListener("click", async () => {
      const amount = Number($("#jphAmount").value);
      if (!amount || !state.editingJobId) { showToast("Enter a valid amount", "error"); return; }
      try {
        const updated = await Api.addOneTimeJobPayment(state.editingJobId, {
          date: $("#jphDate").value,
          amount,
          type: $("#jphType").value,
          note: $("#jphNote").value.trim()
        });
        $("#jPaymentSummary").innerHTML = paymentSummaryHtml(updated);
        $("#jPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(updated, "delete-job-payment-btn");
        $("#jPaymentAddForm").hidden = true;
        $("#jphAmount").value = "";
        $("#jphNote").value = "";
        state.payments = await Api.getPayments();
        showToast("Payment added", "success");
      } catch (err) {
        showToast("Failed to add payment: " + err.message, "error");
      }
    });

    $("#oneTimeJobForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        clientName: $("#jClientName").value,
        clientMobile: $("#jClientMobile").value,
        name: $("#jName").value.trim(),
        category: $("#jCategory").value,
        priority: $("#jPriority").value,
        startDate: $("#jStartDate").value,
        dueDate: $("#jDueDate").value,
        status: $("#jStatus").value,
        totalUnits: Number($("#jTotalUnits").value) || 0,
        doneUnits: Number($("#jDoneUnits").value) || 0,
        totalAmount: Number($("#jTotalAmount").value) || 0,
        notes: $("#jNotes").value.trim()
      };
      try {
        if (state.editingJobId) {
          await Api.updateOneTimeJob(state.editingJobId, payload);
          showToast("Job updated", "success");
        } else {
          await Api.createOneTimeJob(payload);
          showToast("One-time job added", "success");
        }
        closeOneTimeJobModal();
        await refreshClientTabData();
        await refreshClientsGridIfVisible();
        state.payments = await Api.getPayments();
      } catch (err) {
        showToast("Failed to save job: " + err.message, "error");
      }
    });
  }

  /* ---------------- Package type picker ---------------- */

  function openPackageTypePicker() {
    $("#packageTypePickerOverlay").hidden = false;
  }
  function closePackageTypePicker() {
    $("#packageTypePickerOverlay").hidden = true;
  }
  function initPackageTypePicker() {
    $("#closePackageTypePicker").addEventListener("click", () => {
      closePackageTypePicker();
      state.addFlowFromGlobal = false;
    });
    $("#packageTypePickerOverlay").addEventListener("click", (e) => {
      if (e.target.id === "packageTypePickerOverlay") {
        closePackageTypePicker();
        state.addFlowFromGlobal = false;
      }
    });
    $("#pickPostReelType").addEventListener("click", () => {
      closePackageTypePicker();
      if (state.addFlowFromGlobal) {
        state.addFlowFromGlobal = false;
        state.addFlowTarget = "postreel";
        openClientPickerModal();
      } else {
        openPostReelPackageModal(null);
      }
    });
    $("#pickManagementType").addEventListener("click", () => {
      closePackageTypePicker();
      if (state.addFlowFromGlobal) {
        state.addFlowFromGlobal = false;
        state.addFlowTarget = "management";
        openClientPickerModal();
      } else {
        openManagementPackageModal(null);
      }
    });
  }

  /* ---------------- Global "Add" flow: type picker + client picker ---------------- */

  function openAddTypePicker() {
    $("#addTypePickerOverlay").hidden = false;
  }
  function closeAddTypePicker() {
    $("#addTypePickerOverlay").hidden = true;
  }
  function initAddTypePicker() {
    $("#clientsAddBtn").addEventListener("click", openAddTypePicker);
    $("#closeAddTypePicker").addEventListener("click", closeAddTypePicker);
    $("#addTypePickerOverlay").addEventListener("click", (e) => {
      if (e.target.id === "addTypePickerOverlay") closeAddTypePicker();
    });
    $("#pickAddOneTimeType").addEventListener("click", () => {
      closeAddTypePicker();
      state.addFlowTarget = "onetime";
      openClientPickerModal();
    });
    $("#pickAddPackageType").addEventListener("click", () => {
      closeAddTypePicker();
      state.addFlowFromGlobal = true;
      openPackageTypePicker();
    });
  }

  function renderClientPickerList(filter = "") {
    const list = $("#clientPickerList");
    const search = filter.toLowerCase();
    const clients = state.clients.filter((c) =>
      !search || [c.clientName, c.mobile, c.businessName].some((f) => (f || "").toLowerCase().includes(search))
    );
    if (!clients.length) {
      list.innerHTML = `<p class="client-picker-empty">No matching clients — add a new one below.</p>`;
      return;
    }
    list.innerHTML = clients.map((c, idx) => `
      <div class="client-picker-row" data-index="${idx}">
        <div class="client-avatar">${initials(c.clientName)}</div>
        <div class="client-picker-row-info">
          <b>${escapeHtml(c.clientName)}</b>
          <span>${escapeHtml(c.businessName || c.mobile || "")}</span>
        </div>
      </div>`).join("");
    $$(".client-picker-row", list).forEach((row) => {
      row.addEventListener("click", () => {
        selectClientForAddFlow(clients[Number(row.dataset.index)]);
      });
    });
  }

  function selectClientForAddFlow(client) {
    state.currentClient = client;
    state.currentClientKey = client.mobile || client.clientName;
    closeClientPickerModal();

    const target = state.addFlowTarget;
    state.addFlowTarget = null;
    if (target === "onetime") openOneTimeJobModal(null);
    else if (target === "postreel") openPostReelPackageModal(null);
    else if (target === "management") openManagementPackageModal(null);
  }

  async function openClientPickerModal() {
    const titleMap = { onetime: "Select Client — One-Time Job", postreel: "Select Client — Post & Reel Package", management: "Select Client — Management Package" };
    $("#clientPickerTitle").textContent = titleMap[state.addFlowTarget] || "Select Client";
    $("#clientPickerSearch").value = "";
    $("#clientPickerNewName").value = "";
    $("#clientPickerNewMobile").value = "";
    if (!state.clients.length) {
      try { state.clients = await Api.getClients(state.clientsFilterMonth || "all"); } catch (err) { /* fall back to empty list */ }
    }
    renderClientPickerList("");
    $("#clientPickerOverlay").hidden = false;
  }
  function closeClientPickerModal() {
    $("#clientPickerOverlay").hidden = true;
  }
  function initClientPickerModal() {
    $("#closeClientPicker").addEventListener("click", () => {
      closeClientPickerModal();
      state.addFlowTarget = null;
    });
    $("#clientPickerOverlay").addEventListener("click", (e) => {
      if (e.target.id === "clientPickerOverlay") {
        closeClientPickerModal();
        state.addFlowTarget = null;
      }
    });
    $("#clientPickerSearch").addEventListener("input", debounce(() => {
      renderClientPickerList($("#clientPickerSearch").value);
    }, 150));
    $("#clientPickerUseNewBtn").addEventListener("click", () => {
      const name = $("#clientPickerNewName").value.trim();
      if (!name) {
        showToast("Client name is required", "error");
        return;
      }
      const mobile = $("#clientPickerNewMobile").value.trim();
      selectClientForAddFlow({ clientName: name, mobile, businessName: "", totalBusiness: 0, totalReceived: 0, totalPending: 0 });
    });
  }

  /* ---------------- Post & Reel Package modal ---------------- */

  function updatePrPendingCells() {
    const pairs = [["prPostsTotal", "prPostsDone", "prPostsPending"], ["prReelsTotal", "prReelsDone", "prReelsPending"], ["prStoriesTotal", "prStoriesDone", "prStoriesPending"]];
    let totalAll = 0, doneAll = 0;
    pairs.forEach(([totalId, doneId, pendingId]) => {
      const total = Number($(`#${totalId}`).value) || 0;
      const done = Number($(`#${doneId}`).value) || 0;
      $(`#${pendingId}`).textContent = Math.max(total - done, 0);
      totalAll += total;
      doneAll += done;
    });
    const percent = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;
    $("#prProgressFill").style.width = percent + "%";
    $("#prProgressLabel").textContent = percent + "%";
  }

  function openPostReelPackageModal(pkg = null) {
    state.editingPackageId = pkg ? pkg.id : null;
    $("#postReelPackageModalTitle").textContent = pkg ? "Edit Post & Reel Package" : "Add Post & Reel Package";
    $("#prPackageId").value = pkg ? pkg.id : "";
    $("#prClientName").value = state.currentClient.clientName;
    $("#prClientMobile").value = state.currentClient.mobile || "";
    $("#prName").value = pkg ? pkg.name : "";
    $("#prStartDate").value = pkg ? pkg.startDate : new Date().toISOString().slice(0, 10);
    $("#prEndDate").value = pkg ? pkg.endDate : "";
    $("#prStatus").value = pkg ? pkg.status : "Active";
    $("#prTotalAmount").value = pkg ? pkg.totalAmount : "";
    $("#prNotes").value = pkg ? pkg.notes : "";

    const posts = (pkg && pkg.posts) || { total: 0, done: 0 };
    const reels = (pkg && pkg.reels) || { total: 0, done: 0 };
    const stories = (pkg && pkg.stories) || { total: 0, done: 0 };
    $("#prPostsTotal").value = posts.total; $("#prPostsDone").value = posts.done;
    $("#prReelsTotal").value = reels.total; $("#prReelsDone").value = reels.done;
    $("#prStoriesTotal").value = stories.total; $("#prStoriesDone").value = stories.done;
    updatePrPendingCells();

    const paymentSection = $("#prPaymentSection");
    if (pkg) {
      paymentSection.hidden = false;
      $("#prPaymentSummary").innerHTML = paymentSummaryHtml(pkg);
      $("#prPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(pkg, "delete-pr-payment-btn");
      $$(".delete-pr-payment-btn").forEach((btn) => btn.addEventListener("click", async () => {
        try {
          const updated = await Api.deletePackagePayment(pkg.id, btn.dataset.id);
          Object.assign(pkg, updated);
          $("#prPaymentSummary").innerHTML = paymentSummaryHtml(pkg);
          $("#prPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(pkg, "delete-pr-payment-btn");
          state.payments = await Api.getPayments();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      }));
    } else {
      paymentSection.hidden = true;
    }
    $("#prPaymentAddForm").hidden = true;

    $("#postReelPackageModalOverlay").hidden = false;
  }

  function closePostReelPackageModal() {
    $("#postReelPackageModalOverlay").hidden = true;
    $("#postReelPackageForm").reset();
    state.editingPackageId = null;
  }

  function initPostReelPackageModal() {
    $("#closePostReelPackageModal").addEventListener("click", closePostReelPackageModal);
    $("#cancelPostReelPackageBtn").addEventListener("click", closePostReelPackageModal);
    $("#postReelPackageModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "postReelPackageModalOverlay") closePostReelPackageModal();
    });
    ["prPostsTotal", "prPostsDone", "prReelsTotal", "prReelsDone", "prStoriesTotal", "prStoriesDone"].forEach((id) => {
      $(`#${id}`).addEventListener("input", updatePrPendingCells);
    });

    $("#prAddPaymentBtn").addEventListener("click", () => {
      $("#prphDate").value = new Date().toISOString().slice(0, 10);
      $("#prPaymentAddForm").hidden = !$("#prPaymentAddForm").hidden;
    });
    $("#prSavePaymentBtn").addEventListener("click", async () => {
      const amount = Number($("#prphAmount").value);
      if (!amount || !state.editingPackageId) { showToast("Enter a valid amount", "error"); return; }
      try {
        const updated = await Api.addPackagePayment(state.editingPackageId, {
          date: $("#prphDate").value,
          amount,
          type: $("#prphType").value,
          note: $("#prphNote").value.trim()
        });
        $("#prPaymentSummary").innerHTML = paymentSummaryHtml(updated);
        $("#prPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(updated, "delete-pr-payment-btn");
        $("#prPaymentAddForm").hidden = true;
        $("#prphAmount").value = "";
        $("#prphNote").value = "";
        state.payments = await Api.getPayments();
        showToast("Payment added", "success");
      } catch (err) {
        showToast("Failed to add payment: " + err.message, "error");
      }
    });

    $("#postReelPackageForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        clientName: $("#prClientName").value,
        clientMobile: $("#prClientMobile").value,
        type: "PostReel",
        name: $("#prName").value.trim(),
        startDate: $("#prStartDate").value,
        endDate: $("#prEndDate").value,
        status: $("#prStatus").value,
        totalAmount: Number($("#prTotalAmount").value) || 0,
        notes: $("#prNotes").value.trim(),
        posts: { total: Number($("#prPostsTotal").value) || 0, done: Number($("#prPostsDone").value) || 0 },
        reels: { total: Number($("#prReelsTotal").value) || 0, done: Number($("#prReelsDone").value) || 0 },
        stories: { total: Number($("#prStoriesTotal").value) || 0, done: Number($("#prStoriesDone").value) || 0 }
      };
      try {
        if (state.editingPackageId) {
          await Api.updatePackage(state.editingPackageId, payload);
          showToast("Package updated", "success");
        } else {
          await Api.createPackage(payload);
          showToast("Package added", "success");
        }
        closePostReelPackageModal();
        await refreshClientTabData();
        await refreshClientsGridIfVisible();
        state.payments = await Api.getPayments();
      } catch (err) {
        showToast("Failed to save package: " + err.message, "error");
      }
    });
  }

  /* ---------------- Management Package modal ---------------- */

  function renderPlatformChips() {
    $("#platformChipRow").innerHTML = state.platformOptions.map((name) => {
      const selected = state.mgSelectedPlatforms.some((p) => p.name === name);
      return `<button type="button" class="platform-chip ${selected ? "selected" : ""}" data-name="${escapeHtml(name)}">${escapeHtml(name)}</button>`;
    }).join("");

    $$("#platformChipRow .platform-chip").forEach((chip) => chip.addEventListener("click", () => {
      const name = chip.dataset.name;
      const idx = state.mgSelectedPlatforms.findIndex((p) => p.name === name);
      if (idx >= 0) {
        state.mgSelectedPlatforms.splice(idx, 1);
      } else {
        state.mgSelectedPlatforms.push({ name, active: true, posts: 0, reels: 0, stories: 0 });
      }
      renderPlatformChips();
      renderPlatformCounters();
    }));
  }

  function renderPlatformCounters() {
    const area = $("#platformCountersArea");
    if (!state.mgSelectedPlatforms.length) {
      area.innerHTML = `<p class="muted" style="margin-top:10px;">Upar thi platform select karo.</p>`;
      updateMgTotalsRollup();
      return;
    }
    area.innerHTML = `
      <table class="mini-table" style="margin-top:10px;">
        <thead><tr><th>Platform</th><th>Posts</th><th>Reels</th><th>Stories</th></tr></thead>
        <tbody>
          ${state.mgSelectedPlatforms.map((p, idx) => `
            <tr data-idx="${idx}">
              <td>${escapeHtml(p.name)}</td>
              <td><input type="number" min="0" class="mini-input plat-posts" value="${p.posts}" /></td>
              <td><input type="number" min="0" class="mini-input plat-reels" value="${p.reels}" /></td>
              <td><input type="number" min="0" class="mini-input plat-stories" value="${p.stories}" /></td>
            </tr>`).join("")}
        </tbody>
      </table>`;
    $$(".plat-posts, .plat-reels, .plat-stories", area).forEach((input) => input.addEventListener("input", () => {
      const row = input.closest("tr");
      const idx = Number(row.dataset.idx);
      state.mgSelectedPlatforms[idx].posts = Number(row.querySelector(".plat-posts").value) || 0;
      state.mgSelectedPlatforms[idx].reels = Number(row.querySelector(".plat-reels").value) || 0;
      state.mgSelectedPlatforms[idx].stories = Number(row.querySelector(".plat-stories").value) || 0;
      updateMgTotalsRollup();
    }));
    updateMgTotalsRollup();
  }

  function updateMgTotalsRollup() {
    const totals = state.mgSelectedPlatforms.reduce((acc, p) => {
      acc.posts += Number(p.posts) || 0;
      acc.reels += Number(p.reels) || 0;
      acc.stories += Number(p.stories) || 0;
      return acc;
    }, { posts: 0, reels: 0, stories: 0 });
    $("#mgTotalsRollup").innerHTML = `
      <div><span class="cs-label">Posts</span><span class="cs-value">${totals.posts}</span></div>
      <div><span class="cs-label">Reels</span><span class="cs-value">${totals.reels}</span></div>
      <div><span class="cs-label">Stories</span><span class="cs-value">${totals.stories}</span></div>
      <div><span class="cs-label">Total Content</span><span class="cs-value">${totals.posts + totals.reels + totals.stories}</span></div>
    `;
  }

  function openManagementPackageModal(pkg = null) {
    state.editingPackageId = pkg ? pkg.id : null;
    $("#managementPackageModalTitle").textContent = pkg ? "Edit Management Package" : "Add Management Package";
    $("#mgPackageId").value = pkg ? pkg.id : "";
    $("#mgClientName").value = state.currentClient.clientName;
    $("#mgClientMobile").value = state.currentClient.mobile || "";
    $("#mgName").value = pkg ? pkg.name : "";
    $("#mgStartDate").value = pkg ? pkg.startDate : new Date().toISOString().slice(0, 10);
    $("#mgEndDate").value = pkg ? pkg.endDate : "";
    $("#mgStatus").value = pkg ? pkg.status : "Active";
    $("#mgTotalAmount").value = pkg ? pkg.totalAmount : "";
    $("#mgNotes").value = pkg ? pkg.notes : "";

    state.mgSelectedPlatforms = pkg && Array.isArray(pkg.platforms) ? pkg.platforms.map((p) => ({ ...p })) : [];
    renderPlatformChips();
    renderPlatformCounters();

    const paymentSection = $("#mgPaymentSection");
    if (pkg) {
      paymentSection.hidden = false;
      $("#mgPaymentSummary").innerHTML = paymentSummaryHtml(pkg);
      $("#mgPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(pkg, "delete-mg-payment-btn");
      $$(".delete-mg-payment-btn").forEach((btn) => btn.addEventListener("click", async () => {
        try {
          const updated = await Api.deletePackagePayment(pkg.id, btn.dataset.id);
          Object.assign(pkg, updated);
          $("#mgPaymentSummary").innerHTML = paymentSummaryHtml(pkg);
          $("#mgPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(pkg, "delete-mg-payment-btn");
          state.payments = await Api.getPayments();
        } catch (err) {
          showToast("Failed to delete: " + err.message, "error");
        }
      }));
    } else {
      paymentSection.hidden = true;
    }
    $("#mgPaymentAddForm").hidden = true;

    $("#managementPackageModalOverlay").hidden = false;
  }

  function closeManagementPackageModal() {
    $("#managementPackageModalOverlay").hidden = true;
    $("#managementPackageForm").reset();
    state.editingPackageId = null;
    state.mgSelectedPlatforms = [];
  }

  function initManagementPackageModal() {
    $("#closeManagementPackageModal").addEventListener("click", closeManagementPackageModal);
    $("#cancelManagementPackageBtn").addEventListener("click", closeManagementPackageModal);
    $("#managementPackageModalOverlay").addEventListener("click", (e) => {
      if (e.target.id === "managementPackageModalOverlay") closeManagementPackageModal();
    });

    $("#mgAddPaymentBtn").addEventListener("click", () => {
      $("#mgphDate").value = new Date().toISOString().slice(0, 10);
      $("#mgPaymentAddForm").hidden = !$("#mgPaymentAddForm").hidden;
    });
    $("#mgSavePaymentBtn").addEventListener("click", async () => {
      const amount = Number($("#mgphAmount").value);
      if (!amount || !state.editingPackageId) { showToast("Enter a valid amount", "error"); return; }
      try {
        const updated = await Api.addPackagePayment(state.editingPackageId, {
          date: $("#mgphDate").value,
          amount,
          type: $("#mgphType").value,
          note: $("#mgphNote").value.trim()
        });
        $("#mgPaymentSummary").innerHTML = paymentSummaryHtml(updated);
        $("#mgPaymentHistoryBody").innerHTML = paymentHistoryRowsHtml(updated, "delete-mg-payment-btn");
        $("#mgPaymentAddForm").hidden = true;
        $("#mgphAmount").value = "";
        $("#mgphNote").value = "";
        state.payments = await Api.getPayments();
        showToast("Payment added", "success");
      } catch (err) {
        showToast("Failed to add payment: " + err.message, "error");
      }
    });

    $("#managementPackageForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        clientName: $("#mgClientName").value,
        clientMobile: $("#mgClientMobile").value,
        type: "Management",
        name: $("#mgName").value.trim(),
        startDate: $("#mgStartDate").value,
        endDate: $("#mgEndDate").value,
        status: $("#mgStatus").value,
        totalAmount: Number($("#mgTotalAmount").value) || 0,
        notes: $("#mgNotes").value.trim(),
        platforms: state.mgSelectedPlatforms
      };
      try {
        if (state.editingPackageId) {
          await Api.updatePackage(state.editingPackageId, payload);
          showToast("Package updated", "success");
        } else {
          await Api.createPackage(payload);
          showToast("Package added", "success");
        }
        closeManagementPackageModal();
        await refreshClientTabData();
        await refreshClientsGridIfVisible();
        state.payments = await Api.getPayments();
      } catch (err) {
        showToast("Failed to save package: " + err.message, "error");
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
    initClientDrawer();
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
    initOneTimeJobModal();
    initPackageTypePicker();
    initPostReelPackageModal();
    initManagementPackageModal();
    initAddTypePicker();
    initClientPickerModal();

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