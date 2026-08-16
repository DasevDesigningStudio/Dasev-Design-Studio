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
    clients: [],
    leads: [],
    paymentsFilterMonth: "all",
    clientsFilterMonth: "all",
    expensesFilterMonth: "all",
    editingPaymentId: null,
    editingExpenseId: null,
    editingLeadId: null,
    confirmAction: null,
    // CRM: Clients -> Projects -> Packages -> (Platforms | Deliverables)
    crmClients: [],
    crmNav: { clientId: null, projectId: null, packageId: null },
    crmSearch: "",
    charts: { pie: null, monthly: null, category: null, expenseCategory: null }
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

    // CRM
    getCrmClients: () => api("/api/crm/clients"),
    createCrmClient: (data) => api("/api/crm/clients", { method: "POST", body: JSON.stringify(data) }),
    updateCrmClient: (id, data) => api(`/api/crm/clients/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCrmClient: (id) => api(`/api/crm/clients/${id}`, { method: "DELETE" }),

    createCrmProject: (clientId, data) => api(`/api/crm/clients/${clientId}/projects`, { method: "POST", body: JSON.stringify(data) }),
    updateCrmProject: (id, data) => api(`/api/crm/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCrmProject: (id) => api(`/api/crm/projects/${id}`, { method: "DELETE" }),

    createCrmPackage: (projectId, data) => api(`/api/crm/projects/${projectId}/packages`, { method: "POST", body: JSON.stringify(data) }),
    updateCrmPackage: (id, data) => api(`/api/crm/packages/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCrmPackage: (id) => api(`/api/crm/packages/${id}`, { method: "DELETE" }),
    updateCrmPackagePayment: (id, data) => api(`/api/crm/packages/${id}/payment`, { method: "PUT", body: JSON.stringify(data) }),

    createCrmPlatform: (packageId, data) => api(`/api/crm/packages/${packageId}/platforms`, { method: "POST", body: JSON.stringify(data) }),
    updateCrmPlatform: (id, data) => api(`/api/crm/platforms/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCrmPlatform: (id) => api(`/api/crm/platforms/${id}`, { method: "DELETE" }),

    createCrmDeliverable: (packageId, data) => api(`/api/crm/packages/${packageId}/deliverables`, { method: "POST", body: JSON.stringify(data) }),
    updateCrmDeliverable: (id, data) => api(`/api/crm/deliverables/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCrmDeliverable: (id) => api(`/api/crm/deliverables/${id}`, { method: "DELETE" }),
    addCrmDeliverableRevision: (id, data) => api(`/api/crm/deliverables/${id}/revisions`, { method: "POST", body: JSON.stringify(data) }),

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

    getDashboard: (month) => api(`/api/dashboard?month=${encodeURIComponent(month || "all")}`),

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
    if (view === "payments") renderPaymentsView();
    if (view === "clients") renderCrmView();
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
  /* CRM: Clients -> Projects -> Packages -> Platforms/Deliverables     */
  /* ------------------------------------------------------------------ */
  function crmFindClient(id) {
    return state.crmClients.find((c) => c.id === id);
  }
  function crmFindProject(projectId) {
    for (const client of state.crmClients) {
      const project = (client.projects || []).find((p) => p.id === projectId);
      if (project) return { client, project };
    }
    return {};
  }
  function crmFindPackage(packageId) {
    for (const client of state.crmClients) {
      for (const project of client.projects || []) {
        const pkg = (project.packages || []).find((pk) => pk.id === packageId);
        if (pkg) return { client, project, pkg };
      }
    }
    return {};
  }
  function crmFindDeliverable(deliverableId) {
    for (const client of state.crmClients) {
      for (const project of client.projects || []) {
        for (const pkg of project.packages || []) {
          const deliverable = (pkg.deliverables || []).find((d) => d.id === deliverableId);
          if (deliverable) return { pkg, deliverable };
        }
      }
    }
    return {};
  }

  async function renderCrmView() {
    try {
      state.crmClients = await Api.getCrmClients();
    } catch (err) {
      showToast(err.message, "error");
      state.crmClients = [];
    }
    renderCrmBreadcrumb();
    renderCrmPanel();
  }

  function crmGoTo(clientId, projectId, packageId) {
    state.crmNav = { clientId: clientId || null, projectId: projectId || null, packageId: packageId || null };
    renderCrmBreadcrumb();
    renderCrmPanel();
  }

  function renderCrmBreadcrumb() {
    const nav = $("#crmBreadcrumb");
    const { clientId, projectId, packageId } = state.crmNav;
    const crumbs = [`<span class="crumb" data-nav="root">All Clients</span>`];

    const client = clientId ? crmFindClient(clientId) : null;
    if (client) crumbs.push(`<span class="crumb" data-nav="client">${escapeHtml(client.name)}</span>`);

    const project = projectId ? crmFindProject(projectId).project : null;
    if (project) crumbs.push(`<span class="crumb" data-nav="project">${escapeHtml(project.name)}</span>`);

    const pkg = packageId ? crmFindPackage(packageId).pkg : null;
    if (pkg) crumbs.push(`<span class="crumb active" data-nav="package">${escapeHtml(pkg.name)}</span>`);

    nav.innerHTML = crumbs.join(`<i class="fa-solid fa-chevron-right"></i>`);
    $("#crmSearchToolbar").hidden = !!clientId;

    nav.querySelectorAll(".crumb").forEach((el) => {
      el.addEventListener("click", () => {
        const level = el.dataset.nav;
        if (level === "root") crmGoTo(null, null, null);
        else if (level === "client") crmGoTo(clientId, null, null);
        else if (level === "project") crmGoTo(clientId, projectId, null);
      });
    });
  }

  function renderCrmPanel() {
    const { clientId, projectId, packageId } = state.crmNav;
    if (packageId) return renderCrmPackageDetail(packageId);
    if (projectId) return renderCrmPackageList(projectId);
    if (clientId) return renderCrmProjectList(clientId);
    return renderCrmClientList(state.crmSearch);
  }

  // -- Level 0: Client list --
  function renderCrmClientList(search) {
    const panel = $("#crmPanel");
    const term = (search || "").toLowerCase();
    const clients = state.crmClients.filter((c) =>
      !term || [c.name, c.mobile, c.business, c.instagram, c.location].some((f) => (f || "").toLowerCase().includes(term))
    );
    if (!clients.length) {
      panel.innerHTML = `<p style="color:var(--text-muted);">No clients yet. Click "Add Client" to create one.</p>`;
      return;
    }
    panel.innerHTML = `<div class="client-grid">` + clients.map((c) => {
      const projectCount = (c.projects || []).length;
      const packageCount = (c.projects || []).reduce((sum, p) => sum + (p.packages || []).length, 0);
      return `
        <div class="client-card crm-card" data-id="${c.id}">
          <div class="client-card-head">
            <div class="client-avatar">${initials(c.name)}</div>
            <div>
              <h4>${escapeHtml(c.name)}</h4>
              <span>${escapeHtml(c.business || c.mobile || "")}</span>
            </div>
            <div class="crm-card-actions">
              <button class="icon-btn crm-edit-client" data-id="${c.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
              <button class="icon-btn crm-delete-client" data-id="${c.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
          </div>
          <div class="client-stats">
            <div><span class="cs-label">Projects</span><span class="cs-value">${projectCount}</span></div>
            <div><span class="cs-label">Packages</span><span class="cs-value">${packageCount}</span></div>
            <div><span class="cs-label">Location</span><span class="cs-value">${escapeHtml(c.location || "—")}</span></div>
          </div>
          ${c.folderPath ? `<div class="crm-folder-path"><i class="fa-solid fa-folder"></i> ${escapeHtml(c.folderPath)}</div>` : ""}
        </div>
      `;
    }).join("") + `</div>`;

    panel.querySelectorAll(".crm-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".crm-card-actions")) return;
        crmGoTo(card.dataset.id, null, null);
      });
    });
    panel.querySelectorAll(".crm-edit-client").forEach((btn) => {
      btn.addEventListener("click", (e) => { e.stopPropagation(); openCrmClientModal(crmFindClient(btn.dataset.id)); });
    });
    panel.querySelectorAll(".crm-delete-client").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const client = crmFindClient(btn.dataset.id);
        openConfirm("Delete Client?", `This will permanently delete "${client.name}" and all their projects, packages and deliverables.`, async () => {
          try {
            await Api.deleteCrmClient(client.id);
            showToast("Client deleted", "success");
            await renderCrmView();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
    });
  }

  // -- Level 1: Project list (for a client) --
  function renderCrmProjectList(clientId) {
    const client = crmFindClient(clientId);
    const panel = $("#crmPanel");
    if (!client) { panel.innerHTML = ""; return; }

    const projects = client.projects || [];
    panel.innerHTML = `
      <div class="crm-info-card card">
        <div>
          <h3>${escapeHtml(client.name)}</h3>
          <p class="view-subtitle">${escapeHtml(client.mobile || "—")} · ${escapeHtml(client.business || "—")} · ${escapeHtml(client.instagram || "—")}</p>
          ${client.folderPath ? `<div class="crm-folder-path"><i class="fa-solid fa-folder"></i> ${escapeHtml(client.folderPath)}</div>` : ""}
        </div>
        <button class="btn btn-outline btn-sm crm-edit-client" data-id="${client.id}"><i class="fa-solid fa-pen"></i> Edit Client</button>
      </div>
      <div class="crm-section-head">
        <h4>Projects</h4>
        <button class="btn btn-primary btn-sm" id="crmAddProjectBtn"><i class="fa-solid fa-plus"></i> Add Project</button>
      </div>
      ${!projects.length ? `<p style="color:var(--text-muted);">No projects yet.</p>` : `
      <div class="client-grid">
        ${projects.map((p) => `
          <div class="client-card crm-card" data-id="${p.id}">
            <div class="client-card-head">
              <div>
                <h4>${escapeHtml(p.name)}</h4>
                <span>${fmtDate(p.startDate)} — ${fmtDate(p.endDate)}</span>
              </div>
              <div class="crm-card-actions">
                <button class="icon-btn crm-edit-project" data-id="${p.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn crm-delete-project" data-id="${p.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
            <div class="client-stats">
              <div><span class="cs-label">Status</span><span class="cs-value">${escapeHtml(p.status)}</span></div>
              <div><span class="cs-label">Priority</span><span class="cs-value">${escapeHtml(p.priority)}</span></div>
              <div><span class="cs-label">Packages</span><span class="cs-value">${(p.packages || []).length}</span></div>
            </div>
          </div>
        `).join("")}
      </div>`}
    `;

    panel.querySelectorAll(".crm-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".crm-card-actions")) return;
        crmGoTo(client.id, card.dataset.id, null);
      });
    });
    panel.querySelectorAll(".crm-edit-client").forEach((btn) => btn.addEventListener("click", () => openCrmClientModal(client)));
    $("#crmAddProjectBtn")?.addEventListener("click", () => openCrmProjectModal(null, client.id));
    panel.querySelectorAll(".crm-edit-project").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openCrmProjectModal(crmFindProject(btn.dataset.id).project, client.id);
      });
    });
    panel.querySelectorAll(".crm-delete-project").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const { project } = crmFindProject(btn.dataset.id);
        openConfirm("Delete Project?", `This will permanently delete "${project.name}" and all its packages.`, async () => {
          try {
            await Api.deleteCrmProject(project.id);
            showToast("Project deleted", "success");
            await renderCrmView();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
    });
  }

  // -- Level 2: Package list (for a project) --
  function renderCrmPackageList(projectId) {
    const { client, project } = crmFindProject(projectId);
    const panel = $("#crmPanel");
    if (!project) { panel.innerHTML = ""; return; }

    const packages = project.packages || [];
    panel.innerHTML = `
      <div class="crm-info-card card">
        <div>
          <h3>${escapeHtml(project.name)}</h3>
          <p class="view-subtitle">${fmtDate(project.startDate)} — ${fmtDate(project.endDate)} · ${escapeHtml(project.status)} · ${escapeHtml(project.priority)} priority</p>
        </div>
        <button class="btn btn-outline btn-sm" id="crmEditProjectBtn"><i class="fa-solid fa-pen"></i> Edit Project</button>
      </div>
      <div class="crm-section-head">
        <h4>Packages</h4>
        <button class="btn btn-primary btn-sm" id="crmAddPackageBtn"><i class="fa-solid fa-plus"></i> Add Package</button>
      </div>
      ${!packages.length ? `<p style="color:var(--text-muted);">No packages yet.</p>` : `
      <div class="client-grid">
        ${packages.map((pk) => `
          <div class="client-card crm-card" data-id="${pk.id}">
            <div class="client-card-head">
              <div>
                <h4>${escapeHtml(pk.name)} <span class="badge pkg-type ${pk.type}">${pk.type}</span></h4>
                <span>${fmtDate(pk.startDate)} — ${fmtDate(pk.endDate)}</span>
              </div>
              <div class="crm-card-actions">
                <button class="icon-btn crm-edit-package" data-id="${pk.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                <button class="icon-btn crm-delete-package" data-id="${pk.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
              </div>
            </div>
            <div class="client-stats">
              <div><span class="cs-label">Total</span><span class="cs-value">${fmtMoney(pk.payment.total)}</span></div>
              <div><span class="cs-label">Paid</span><span class="cs-value">${fmtMoney(pk.payment.paid)}</span></div>
              <div><span class="cs-label">Status</span><span class="cs-value"><span class="badge ${statusClass(pk.payment.status)}">${pk.payment.status}</span></span></div>
            </div>
          </div>
        `).join("")}
      </div>`}
    `;

    panel.querySelectorAll(".crm-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        if (e.target.closest(".crm-card-actions")) return;
        crmGoTo(client.id, project.id, card.dataset.id);
      });
    });
    $("#crmEditProjectBtn")?.addEventListener("click", () => openCrmProjectModal(project, client.id));
    $("#crmAddPackageBtn")?.addEventListener("click", () => openCrmPackageModal(null, project.id));
    panel.querySelectorAll(".crm-edit-package").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openCrmPackageModal(crmFindPackage(btn.dataset.id).pkg, project.id);
      });
    });
    panel.querySelectorAll(".crm-delete-package").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const { pkg } = crmFindPackage(btn.dataset.id);
        openConfirm("Delete Package?", `This will permanently delete "${pkg.name}" and everything inside it.`, async () => {
          try {
            await Api.deleteCrmPackage(pkg.id);
            showToast("Package deleted", "success");
            await renderCrmView();
          } catch (err) { showToast(err.message, "error"); }
        });
      });
    });
  }

  // -- Level 3: Package detail (Management platforms OR Deliverable items) --
  function renderCrmPackageDetail(packageId) {
    const { client, project, pkg } = crmFindPackage(packageId);
    const panel = $("#crmPanel");
    if (!pkg) { panel.innerHTML = ""; return; }

    const pay = pkg.payment;
    panel.innerHTML = `
      <div class="crm-info-card card">
        <div>
          <h3>${escapeHtml(pkg.name)} <span class="badge pkg-type ${pkg.type}">${pkg.type}</span></h3>
          <p class="view-subtitle">${fmtDate(pkg.startDate)} — ${fmtDate(pkg.endDate)}</p>
        </div>
        <button class="btn btn-outline btn-sm" id="crmEditPackageBtn"><i class="fa-solid fa-pen"></i> Edit Package</button>
      </div>

      <div class="crm-payment-card card">
        <div class="client-stats" style="border-top:none; padding-top:0;">
          <div><span class="cs-label">Total</span><span class="cs-value">${fmtMoney(pay.total)}</span></div>
          <div><span class="cs-label">Paid</span><span class="cs-value">${fmtMoney(pay.paid)}</span></div>
          <div><span class="cs-label">Pending</span><span class="cs-value">${fmtMoney(pay.pending)}</span></div>
          <div><span class="cs-label">Due Date</span><span class="cs-value">${fmtDate(pay.dueDate)}</span></div>
          <div><span class="cs-label">Status</span><span class="cs-value"><span class="badge ${statusClass(pay.status)}">${pay.status}</span></span></div>
        </div>
        <div class="crm-payment-actions">
          <button class="btn btn-outline btn-sm" id="crmEditPaymentTermsBtn"><i class="fa-solid fa-pen"></i> Payment Terms</button>
          <button class="btn btn-primary btn-sm" id="crmLogPaymentBtn"><i class="fa-solid fa-plus"></i> Log Payment</button>
        </div>
        ${(pay.history && pay.history.length) ? `
          <div class="table-scroll" style="margin-top:12px;">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Amount</th><th>Note</th></tr></thead>
              <tbody>
                ${pay.history.slice().reverse().map((h) => `<tr><td>${fmtDate(h.date)}</td><td>${fmtMoney(h.amount)}</td><td>${escapeHtml(h.note || "—")}</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
        ` : ""}
      </div>

      ${pkg.type === "Management" ? renderCrmPlatformsSection(pkg) : renderCrmDeliverablesSection(pkg)}
    `;

    $("#crmEditPackageBtn")?.addEventListener("click", () => openCrmPackageModal(pkg, project.id));
    $("#crmEditPaymentTermsBtn")?.addEventListener("click", () => openCrmPaymentModal(pkg));
    $("#crmLogPaymentBtn")?.addEventListener("click", () => openCrmLogPaymentModal(pkg));

    if (pkg.type === "Management") {
      $("#crmAddPlatformBtn")?.addEventListener("click", () => openCrmPlatformModal(null, pkg.id));
      panel.querySelectorAll(".crm-edit-platform").forEach((btn) => {
        btn.addEventListener("click", () => {
          const platform = (pkg.platforms || []).find((pl) => pl.id === btn.dataset.id);
          openCrmPlatformModal(platform, pkg.id);
        });
      });
      panel.querySelectorAll(".crm-delete-platform").forEach((btn) => {
        btn.addEventListener("click", () => {
          openConfirm("Delete Platform?", "This will remove this platform's counts from the package.", async () => {
            try {
              await Api.deleteCrmPlatform(btn.dataset.id);
              showToast("Platform deleted", "success");
              await renderCrmView();
            } catch (err) { showToast(err.message, "error"); }
          });
        });
      });
    } else {
      $("#crmAddDeliverableBtn")?.addEventListener("click", () => openCrmDeliverableModal(null, pkg.id));
      panel.querySelectorAll(".crm-deliverable-row").forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".crm-row-actions")) return;
          openCrmDeliverableDetail(row.dataset.id);
        });
      });
      panel.querySelectorAll(".crm-edit-deliverable").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const deliverable = (pkg.deliverables || []).find((d) => d.id === btn.dataset.id);
          openCrmDeliverableModal(deliverable, pkg.id);
        });
      });
      panel.querySelectorAll(".crm-delete-deliverable").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openConfirm("Delete Deliverable?", "This will permanently delete this deliverable.", async () => {
            try {
              await Api.deleteCrmDeliverable(btn.dataset.id);
              showToast("Deliverable deleted", "success");
              await renderCrmView();
            } catch (err) { showToast(err.message, "error"); }
          });
        });
      });
    }
  }

  function renderCrmPlatformsSection(pkg) {
    const platforms = pkg.platforms || [];
    return `
      <div class="crm-section-head">
        <h4>Platforms <span style="font-weight:400; color:var(--text-muted); font-size:12px;">(count-based — no per-post detail)</span></h4>
        <button class="btn btn-primary btn-sm" id="crmAddPlatformBtn"><i class="fa-solid fa-plus"></i> Add Platform</button>
      </div>
      ${!platforms.length ? `<p style="color:var(--text-muted);">No platforms added yet.</p>` : `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Platform</th><th>Posts</th><th>Reels</th><th>Stories</th><th></th></tr></thead>
          <tbody>
            ${platforms.map((pl) => `
              <tr>
                <td>${escapeHtml(pl.name)}</td>
                <td>${pl.posts}</td>
                <td>${pl.reels}</td>
                <td>${pl.stories}</td>
                <td class="crm-row-actions">
                  <button class="icon-btn crm-edit-platform" data-id="${pl.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                  <button class="icon-btn crm-delete-platform" data-id="${pl.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`}
    `;
  }

  function renderCrmDeliverablesSection(pkg) {
    const deliverables = pkg.deliverables || [];
    return `
      <div class="crm-section-head">
        <h4>Deliverables</h4>
        <button class="btn btn-primary btn-sm" id="crmAddDeliverableBtn"><i class="fa-solid fa-plus"></i> Add Deliverable</button>
      </div>
      ${!deliverables.length ? `<p style="color:var(--text-muted);">No deliverables yet.</p>` : `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>Type</th><th>Platform</th><th>Due</th><th>Status</th><th>File Location</th><th></th></tr></thead>
          <tbody>
            ${deliverables.map((d) => `
              <tr class="crm-deliverable-row" data-id="${d.id}">
                <td>${escapeHtml(d.type)}</td>
                <td>${escapeHtml(d.platform || "—")}</td>
                <td>${fmtDate(d.dueDate)}</td>
                <td><span class="badge ${d.status === "Completed" ? "Paid" : (d.status === "In Progress" || d.status === "Review") ? "Partial" : "Pending"}">${escapeHtml(d.status)}</span></td>
                <td class="crm-file-location" title="${escapeHtml(d.fileLocation || "")}">${d.fileLocation ? `<i class="fa-solid fa-folder-open"></i> ${escapeHtml(d.fileLocation)}` : "—"}</td>
                <td class="crm-row-actions">
                  <button class="icon-btn crm-edit-deliverable" data-id="${d.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                  <button class="icon-btn crm-delete-deliverable" data-id="${d.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`}
    `;
  }

  function openCrmDeliverableDetail(deliverableId) {
    const { pkg, deliverable: d } = crmFindDeliverable(deliverableId);
    if (!d) return;
    $("#clientDrawerTitle").textContent = `${d.type} — ${pkg.name}`;
    $("#clientDrawerBody").innerHTML = `
      <div style="display:flex; flex-direction:column; gap:16px;">
        <div class="client-stats" style="border-top:none; padding-top:0;">
          <div><span class="cs-label">Status</span><span class="cs-value">${escapeHtml(d.status)}</span></div>
          <div><span class="cs-label">Platform</span><span class="cs-value">${escapeHtml(d.platform || "—")}</span></div>
          <div><span class="cs-label">Due</span><span class="cs-value">${fmtDate(d.dueDate)}</span></div>
        </div>
        <p style="font-size:13px; color:var(--text-muted);">
          <b>Start:</b> ${fmtDate(d.startDate)} &nbsp; <b>Completed:</b> ${fmtDate(d.completedDate)} &nbsp; <b>Publish:</b> ${fmtDate(d.publishDate)}<br/>
          <b>URL:</b> ${d.url ? `<a href="${escapeHtml(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.url)}</a>` : "—"}<br/>
          <b>File Location:</b> ${escapeHtml(d.fileLocation || "—")}
        </p>
        <div>
          <div class="crm-section-head" style="margin-bottom:8px;">
            <h4 style="font-size:14px;">Revisions</h4>
            <button class="btn btn-outline btn-sm" id="crmAddRevisionBtn"><i class="fa-solid fa-plus"></i> Add Revision</button>
          </div>
          ${(d.revisions && d.revisions.length) ? `
            <ul style="margin:0; padding-left:18px; font-size:13px; color:var(--text-muted);">
              ${d.revisions.map((r) => `<li><b>${fmtDate(r.date)}:</b> ${escapeHtml(r.note || "—")}</li>`).join("")}
            </ul>
          ` : `<p style="color:var(--text-muted); font-size:13px;">No revisions logged.</p>`}
        </div>
      </div>
    `;
    $("#crmAddRevisionBtn")?.addEventListener("click", () => openCrmRevisionModal(d.id));
    $("#clientDrawerOverlay").hidden = false;
  }

  /* ---- CRM modal open/close + form submit wiring ---- */

  function openCrmClientModal(client) {
    $("#crmClientModalTitle").textContent = client ? "Edit Client" : "Add Client";
    $("#crmClientId").value = client?.id || "";
    $("#crmCName").value = client?.name || "";
    $("#crmCMobile").value = client?.mobile || "";
    $("#crmCBusiness").value = client?.business || "";
    $("#crmCInstagram").value = client?.instagram || "";
    $("#crmCLocation").value = client?.location || "";
    $("#crmCFolderPath").value = client?.folderPath || "";
    $("#crmClientModalOverlay").hidden = false;
  }

  function openCrmProjectModal(project, clientId) {
    $("#crmProjectModalTitle").textContent = project ? "Edit Project" : "Add Project";
    $("#crmProjectId").value = project?.id || "";
    $("#crmProjectForm").dataset.clientId = clientId;
    $("#crmPName").value = project?.name || "";
    $("#crmPStart").value = project?.startDate || "";
    $("#crmPEnd").value = project?.endDate || "";
    $("#crmPStatus").value = project?.status || "Active";
    $("#crmPPriority").value = project?.priority || "Medium";
    $("#crmProjectModalOverlay").hidden = false;
  }

  function openCrmPackageModal(pkg, projectId) {
    $("#crmPackageModalTitle").textContent = pkg ? "Edit Package" : "Add Package";
    $("#crmPackageId").value = pkg?.id || "";
    $("#crmPackageForm").dataset.projectId = projectId;
    $("#crmPkgName").value = pkg?.name || "";
    $("#crmPkgType").value = pkg?.type || "Deliverable";
    $("#crmPkgStart").value = pkg?.startDate || "";
    $("#crmPkgEnd").value = pkg?.endDate || "";
    $("#crmPackageModalOverlay").hidden = false;
  }

  function openCrmPaymentModal(pkg) {
    $("#crmPaymentPackageId").value = pkg.id;
    $("#crmPayTotal").value = pkg.payment.total || 0;
    $("#crmPayDueDate").value = pkg.payment.dueDate || "";
    $("#crmPaymentModalOverlay").hidden = false;
  }

  function openCrmLogPaymentModal(pkg) {
    $("#crmLogPackageId").value = pkg.id;
    $("#crmLogAmount").value = "";
    $("#crmLogDate").value = new Date().toISOString().slice(0, 10);
    $("#crmLogNote").value = "";
    $("#crmLogPaymentModalOverlay").hidden = false;
  }

  function openCrmPlatformModal(platform, packageId) {
    $("#crmPlatformModalTitle").textContent = platform ? "Edit Platform" : "Add Platform";
    $("#crmPlatformId").value = platform?.id || "";
    $("#crmPlatformPackageId").value = packageId;
    $("#crmPlName").value = platform?.name || "";
    $("#crmPlPosts").value = platform?.posts ?? 0;
    $("#crmPlReels").value = platform?.reels ?? 0;
    $("#crmPlStories").value = platform?.stories ?? 0;
    $("#crmPlatformModalOverlay").hidden = false;
  }

  function openCrmDeliverableModal(deliverable, packageId) {
    $("#crmDeliverableModalTitle").textContent = deliverable ? "Edit Deliverable" : "Add Deliverable";
    $("#crmDeliverableId").value = deliverable?.id || "";
    $("#crmDeliverablePackageId").value = packageId;
    $("#crmDelType").value = deliverable?.type || "Post";
    $("#crmDelStatus").value = deliverable?.status || "Pending";
    $("#crmDelStart").value = deliverable?.startDate || "";
    $("#crmDelDue").value = deliverable?.dueDate || "";
    $("#crmDelCompleted").value = deliverable?.completedDate || "";
    $("#crmDelPlatform").value = deliverable?.platform || "";
    $("#crmDelPublishDate").value = deliverable?.publishDate || "";
    $("#crmDelUrl").value = deliverable?.url || "";
    $("#crmDelFileLocation").value = deliverable?.fileLocation || "";
    $("#crmDeliverableModalOverlay").hidden = false;
  }

  function openCrmRevisionModal(deliverableId) {
    $("#crmRevisionDeliverableId").value = deliverableId;
    $("#crmRevDate").value = new Date().toISOString().slice(0, 10);
    $("#crmRevNote").value = "";
    $("#crmRevisionModalOverlay").hidden = false;
  }

  function initCrmModule() {
    $("#crmAddClientBtn").addEventListener("click", () => openCrmClientModal(null));

    $("#clientSearch").addEventListener("input", debounce(() => {
      state.crmSearch = $("#clientSearch").value;
      if (!state.crmNav.clientId) renderCrmClientList(state.crmSearch);
    }, 200));

    $("#closeCrmClientModal").addEventListener("click", () => { $("#crmClientModalOverlay").hidden = true; });
    $("#cancelCrmClientBtn").addEventListener("click", () => { $("#crmClientModalOverlay").hidden = true; });
    $("#crmClientForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#crmClientId").value;
      const payload = {
        name: $("#crmCName").value.trim(),
        mobile: $("#crmCMobile").value.trim(),
        business: $("#crmCBusiness").value.trim(),
        instagram: $("#crmCInstagram").value.trim(),
        location: $("#crmCLocation").value.trim(),
        folderPath: $("#crmCFolderPath").value.trim()
      };
      try {
        if (id) await Api.updateCrmClient(id, payload);
        else await Api.createCrmClient(payload);
        $("#crmClientModalOverlay").hidden = true;
        showToast(id ? "Client updated" : "Client added", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmProjectModal").addEventListener("click", () => { $("#crmProjectModalOverlay").hidden = true; });
    $("#cancelCrmProjectBtn").addEventListener("click", () => { $("#crmProjectModalOverlay").hidden = true; });
    $("#crmProjectForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#crmProjectId").value;
      const clientId = $("#crmProjectForm").dataset.clientId;
      const payload = {
        name: $("#crmPName").value.trim(),
        startDate: $("#crmPStart").value,
        endDate: $("#crmPEnd").value,
        status: $("#crmPStatus").value,
        priority: $("#crmPPriority").value
      };
      try {
        if (id) await Api.updateCrmProject(id, payload);
        else await Api.createCrmProject(clientId, payload);
        $("#crmProjectModalOverlay").hidden = true;
        showToast(id ? "Project updated" : "Project added", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmPackageModal").addEventListener("click", () => { $("#crmPackageModalOverlay").hidden = true; });
    $("#cancelCrmPackageBtn").addEventListener("click", () => { $("#crmPackageModalOverlay").hidden = true; });
    $("#crmPackageForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#crmPackageId").value;
      const projectId = $("#crmPackageForm").dataset.projectId;
      const payload = {
        name: $("#crmPkgName").value.trim(),
        type: $("#crmPkgType").value,
        startDate: $("#crmPkgStart").value,
        endDate: $("#crmPkgEnd").value
      };
      try {
        if (id) await Api.updateCrmPackage(id, payload);
        else await Api.createCrmPackage(projectId, payload);
        $("#crmPackageModalOverlay").hidden = true;
        showToast(id ? "Package updated" : "Package added", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmPaymentModal").addEventListener("click", () => { $("#crmPaymentModalOverlay").hidden = true; });
    $("#cancelCrmPaymentBtn").addEventListener("click", () => { $("#crmPaymentModalOverlay").hidden = true; });
    $("#crmPaymentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const packageId = $("#crmPaymentPackageId").value;
      const payload = { total: Number($("#crmPayTotal").value) || 0, dueDate: $("#crmPayDueDate").value };
      try {
        await Api.updateCrmPackagePayment(packageId, payload);
        $("#crmPaymentModalOverlay").hidden = true;
        showToast("Payment terms updated", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmLogPaymentModal").addEventListener("click", () => { $("#crmLogPaymentModalOverlay").hidden = true; });
    $("#cancelCrmLogPaymentBtn").addEventListener("click", () => { $("#crmLogPaymentModalOverlay").hidden = true; });
    $("#crmLogPaymentForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const packageId = $("#crmLogPackageId").value;
      const payload = {
        logEntry: true,
        amount: Number($("#crmLogAmount").value) || 0,
        date: $("#crmLogDate").value,
        note: $("#crmLogNote").value.trim()
      };
      try {
        await Api.updateCrmPackagePayment(packageId, payload);
        $("#crmLogPaymentModalOverlay").hidden = true;
        showToast("Payment logged", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmPlatformModal").addEventListener("click", () => { $("#crmPlatformModalOverlay").hidden = true; });
    $("#cancelCrmPlatformBtn").addEventListener("click", () => { $("#crmPlatformModalOverlay").hidden = true; });
    $("#crmPlatformForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#crmPlatformId").value;
      const packageId = $("#crmPlatformPackageId").value;
      const payload = {
        name: $("#crmPlName").value.trim(),
        posts: Number($("#crmPlPosts").value) || 0,
        reels: Number($("#crmPlReels").value) || 0,
        stories: Number($("#crmPlStories").value) || 0
      };
      try {
        if (id) await Api.updateCrmPlatform(id, payload);
        else await Api.createCrmPlatform(packageId, payload);
        $("#crmPlatformModalOverlay").hidden = true;
        showToast(id ? "Platform updated" : "Platform added", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmDeliverableModal").addEventListener("click", () => { $("#crmDeliverableModalOverlay").hidden = true; });
    $("#cancelCrmDeliverableBtn").addEventListener("click", () => { $("#crmDeliverableModalOverlay").hidden = true; });
    $("#crmDelSuggestPathBtn").addEventListener("click", () => {
      const packageId = $("#crmDeliverablePackageId").value;
      const { client } = crmFindPackage(packageId);
      if (!client || !client.folderPath) { showToast("This client has no Folder Path set yet", "error"); return; }
      const sep = client.folderPath.endsWith("\\") || client.folderPath.endsWith("/") ? "" : "\\";
      const type = $("#crmDelType").value || "Files";
      $("#crmDelFileLocation").value = `${client.folderPath}${sep}${type}\\`;
    });
    $("#crmDeliverableForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $("#crmDeliverableId").value;
      const packageId = $("#crmDeliverablePackageId").value;
      const payload = {
        type: $("#crmDelType").value,
        status: $("#crmDelStatus").value,
        startDate: $("#crmDelStart").value,
        dueDate: $("#crmDelDue").value,
        completedDate: $("#crmDelCompleted").value,
        platform: $("#crmDelPlatform").value.trim(),
        publishDate: $("#crmDelPublishDate").value,
        url: $("#crmDelUrl").value.trim(),
        fileLocation: $("#crmDelFileLocation").value.trim()
      };
      try {
        if (id) await Api.updateCrmDeliverable(id, payload);
        else await Api.createCrmDeliverable(packageId, payload);
        $("#crmDeliverableModalOverlay").hidden = true;
        showToast(id ? "Deliverable updated" : "Deliverable added", "success");
        await renderCrmView();
      } catch (err) { showToast(err.message, "error"); }
    });

    $("#closeCrmRevisionModal").addEventListener("click", () => { $("#crmRevisionModalOverlay").hidden = true; });
    $("#cancelCrmRevisionBtn").addEventListener("click", () => { $("#crmRevisionModalOverlay").hidden = true; });
    $("#crmRevisionForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const deliverableId = $("#crmRevisionDeliverableId").value;
      const payload = { date: $("#crmRevDate").value, note: $("#crmRevNote").value.trim() };
      try {
        await Api.addCrmDeliverableRevision(deliverableId, payload);
        $("#crmRevisionModalOverlay").hidden = true;
        showToast("Revision added", "success");
        await renderCrmView();
        openCrmDeliverableDetail(deliverableId);
      } catch (err) { showToast(err.message, "error"); }
    });

    [
      "crmClientModalOverlay", "crmProjectModalOverlay", "crmPackageModalOverlay",
      "crmPaymentModalOverlay", "crmLogPaymentModalOverlay", "crmPlatformModalOverlay",
      "crmDeliverableModalOverlay", "crmRevisionModalOverlay"
    ].forEach((id) => {
      $(`#${id}`).addEventListener("click", (e) => { if (e.target.id === id) $(`#${id}`).hidden = true; });
    });
  }

  function initClientDrawer() {
    $("#closeClientDrawer").addEventListener("click", () => { $("#clientDrawerOverlay").hidden = true; });
    $("#clientDrawerOverlay").addEventListener("click", (e) => {
      if (e.target.id === "clientDrawerOverlay") $("#clientDrawerOverlay").hidden = true;
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
  async function loadInitialData() {
    const [payments, categories, settings, expenses, expenseCategories, leads] = await Promise.all([
      Api.getPayments(),
      Api.getCategories(),
      Api.getSettings(),
      Api.getExpenses(),
      Api.getExpenseCategories(),
      Api.getLeads()
    ]);
    state.payments = payments;
    state.categories = categories;
    state.settings = settings;
    state.expenses = expenses;
    state.expenseCategories = expenseCategories;
    state.leads = leads;

    applySettingsToUI();
    renderGreeting();
    populateCategorySelects();

    await loadDashboard();

    const view = (window.location.hash || "#dashboard").slice(1);
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
    initCrmModule();
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