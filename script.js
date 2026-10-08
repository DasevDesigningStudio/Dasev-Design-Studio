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
    paymentsFilterMonth: currentMonthKey(),   // default: current month (pick "All Months" to see everything)
    clientsFilterMonth: currentMonthKey(),
    expensesFilterMonth: currentMonthKey(),
    pickerClients: [],                        // ALL clients, used by the client picker
    editingPaymentId: null,
    editingExpenseId: null,
    editingLeadId: null,
    confirmAction: null,
    charts: { pie: null, monthly: null, category: null, expenseCategory: null },

    // One-Time Jobs / Packages (per open Client)
    oneTimeJobs: [],
    packages: [],
    platformOptions: [],
    contentProduction: [],
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
    if (res.status === 401) {
      window.location.href = "/login";
      throw new Error("Session purou thayu — pharithi login karo.");
    }
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
    getMe: () => api("/api/me"),
    getUsers: () => api("/api/users"),
    createUser: (d) => api("/api/users", { method: "POST", body: JSON.stringify(d) }),
    updateUser: (id, d) => api(`/api/users/${id}`, { method: "PUT", body: JSON.stringify(d) }),
    resetUserPassword: (id) => api(`/api/users/${id}/reset-password`, { method: "POST" }),
    getCalendar: () => api("/api/calendar"),
    createCalendarEvent: (data) => api("/api/calendar-events", { method: "POST", body: JSON.stringify(data) }),
    updateCalendarEvent: (id, data) => api(`/api/calendar-events/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
    deleteCalendarEvent: (id) => api(`/api/calendar-events/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
    addPackageWork: (id, data) => api(`/api/packages/${id}/works`, { method: "POST", body: JSON.stringify(data) }),
    updatePackageWork: (id, workId, data) => api(`/api/packages/${id}/works/${workId}`, { method: "PUT", body: JSON.stringify(data) }),
    deletePackageWork: (id, workId) => api(`/api/packages/${id}/works/${workId}`, { method: "DELETE" }),
    getPackageActivity: (id) => api(`/api/packages/${id}/activity`),

    getPlatformOptions: () => api("/api/platform-options"),
    getContentProduction: (params = {}) => { const q = new URLSearchParams(); Object.entries(params).forEach(([k,v]) => { if (v && v !== "all") q.set(k, v); }); return api(`/api/content-production${q.toString() ? `?${q.toString()}` : ""}`); },
    getContentProductionItem: (id) => api(`/api/content-production/${encodeURIComponent(id)}`),
    createContentProduction: (data) => api("/api/content-production", { method:"POST", body:JSON.stringify(data) }),
    updateContentProduction: (id, data) => api(`/api/content-production/${encodeURIComponent(id)}`, { method:"PUT", body:JSON.stringify(data) }),
    updateContentProductionStage: (id, stage, meta = {}) => api(`/api/content-production/${encodeURIComponent(id)}/stage`, { method:"PATCH", body:JSON.stringify({stage, ...meta}) }),
    duplicateContentProduction: (id) => api(`/api/content-production/${encodeURIComponent(id)}/duplicate`, { method:"POST" }),
    addProductionRevision: (id, data) => api(`/api/content-production/${encodeURIComponent(id)}/revisions`, { method:"POST", body:JSON.stringify(data) }),
    updateProductionRevision: (id, revId, data) => api(`/api/content-production/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revId)}`, { method:"PATCH", body:JSON.stringify(data) }),
    deleteContentProduction: (id) => api(`/api/content-production/${encodeURIComponent(id)}`, { method:"DELETE" }),
    getClientOverview: (key) => api(`/api/clients/${encodeURIComponent(key)}/overview`),

    getClientProfiles: () => api("/api/client-profiles"),
    updateClientDetails: (clientId, data) => api(`/api/clients/${encodeURIComponent(clientId)}/details`, { method: "PUT", body: JSON.stringify(data) }),
    updateClientProfile: (key, data) => api(`/api/client-profiles/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(data) }),

    getDashboard: (month) => api(`/api/dashboard?month=${encodeURIComponent(month || "all")}`),
    getOverview: (month) => api(`/api/overview?month=${encodeURIComponent(month || "all")}`),

    getReport: (type, status, from = "", to = "") => api(`/api/reports?type=${encodeURIComponent(type)}&status=${encodeURIComponent(status || "")}&from=${from}&to=${to}`),
    getTopClients: (from = "", to = "") => api(`/api/reports/top-clients?from=${from}&to=${to}`)
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
    // Always offer the current month, even if it has no records yet.
    const cur = currentMonthKey();
    const list = [...new Set([cur, ...months])].sort().reverse();
    sel.innerHTML = `<option value="all">All Months</option>` +
      list.map((key) => `<option value="${key}">${monthShortLabel(key)}${key === cur ? " (Current)" : ""}</option>`).join("");
    sel.value = list.includes(currentValue) || currentValue === "all" ? currentValue : cur;
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
  function parseHash() {
    const [view, arg] = (window.location.hash || "#dashboard").slice(1).split("/");
    return { view, arg: arg ? decodeURIComponent(arg) : "" };
  }

  function setActiveView(view, arg) {
    if (state.me && !viewAllowed(view)) view = firstAllowedView();
    $$(".view").forEach((v) => v.classList.remove("active"));
    const target = $(`#view-${view}`);
    if (target) target.classList.add("active");

    $$(".nav-item[data-view]").forEach((nav) => {
      nav.classList.toggle("active", nav.dataset.view === view);
    });

    // Lazy-load per-view data
    if (view === "payments") renderPaymentsView();
    if (view === "clients") renderClientsView();
    if (view === "leads") renderLeadsView();
    if (view === "reports") { populatePeriodSelect($("#reportPeriod"), "this-month"); runReport(); }
    if (view === "categories") renderCategoriesView();
    if (view === "expenses") renderExpensesView();
    if (view === "export") { populateInvoiceSelect(); populatePdfMonthSelect(); }
    if (view === "settings") { renderSettingsForm(); renderTeamCard(); }
    if (view === "packages") renderPackagesView(arg);
    if (view === "calendar") renderCalendarView();
    if (view === "content-production") renderContentProductionView();

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

    // Collapsible groups (Work, Finance)
    $$(".nav-parent[data-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        btn.classList.toggle("open");
        const sub = document.getElementById(btn.dataset.toggle);
        if (sub) sub.classList.toggle("open");
      });
    });

    // Links that open a view without becoming "active" (e.g. Packages -> Clients)
    $$(".nav-item[data-goto]").forEach((nav) => {
      nav.addEventListener("click", (e) => {
        e.preventDefault();
        window.location.hash = nav.dataset.goto;
        setActiveView(nav.dataset.goto);
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
      const { view, arg } = parseHash();
      setActiveView(view, arg);
    });
  }

  /* ====================== Agency Calendar ====================== */
  const CAL = { view: "month", cursor: new Date(), events: [], hidden: new Set(), editingId: null };
  const CAL_TYPE_LABEL = { payment: "Payment due", lead: "Lead follow-up", job: "Job due", package: "Package ends", manual: "My event" };
  const CAL_LINK_LABEL = { payments: "Payments", leads: "Leads", clients: "Clients" };
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const calFmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const calParse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const calAddDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function calEventsByDate() {
    const map = {};
    CAL.events.filter((e) => !CAL.hidden.has(e.type)).forEach((e) => { (map[e.date] = map[e.date] || []).push(e); });
    Object.values(map).forEach((list) => list.sort((a, b) => (a.allDay === b.allDay ? (a.startTime || "").localeCompare(b.startTime || "") : (a.allDay ? -1 : 1))));
    return map;
  }

  function calChip(e) {
    const today = calFmt(new Date());
    const overdue = (e.type === "payment" || e.type === "job") && e.date < today ? " overdue" : "";
    const time = !e.allDay && e.startTime ? e.startTime + " " : "";
    return `<div class="cal-chip cal-${e.type}${overdue}" data-evid="${escapeHtml(e.id)}" title="${escapeHtml(e.title)}">${escapeHtml(time + e.title)}</div>`;
  }

  function calDayCell(date, byDate, opts = {}) {
    const key = calFmt(date);
    const list = byDate[key] || [];
    const max = opts.max || 3;
    const shown = list.slice(0, max).map(calChip).join("");
    const more = list.length > max ? `<div class="cal-more" data-gotoday="${key}">+${list.length - max} more</div>` : "";
    const cls = ["cal-cell", opts.other ? "other" : "", key === calFmt(new Date()) ? "today" : "", opts.week ? "week" : ""].join(" ");
    return `<div class="${cls}" data-date="${key}"><div class="cal-daynum">${date.getDate()}</div>${shown}${more}</div>`;
  }

  function calTitleText() {
    const c = CAL.cursor;
    if (CAL.view === "month") return `${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
    if (CAL.view === "week") {
      const s = calAddDays(c, -c.getDay()), e = calAddDays(s, 6);
      return `${MONTHS[s.getMonth()].slice(0, 3)} ${s.getDate()} – ${MONTHS[e.getMonth()].slice(0, 3)} ${e.getDate()}, ${e.getFullYear()}`;
    }
    if (CAL.view === "day") return `${DAYS_SHORT[c.getDay()]}, ${c.getDate()} ${MONTHS[c.getMonth()]} ${c.getFullYear()}`;
    return "Upcoming (next 60 days)";
  }

  function drawCalendar() {
    $("#calTitle").textContent = calTitleText();
    $$("#calViews button").forEach((b) => b.classList.toggle("active", b.dataset.calview === CAL.view));
    const byDate = calEventsByDate();
    const body = $("#calBody");
    const c = CAL.cursor;
    let html = "";

    if (CAL.view === "month") {
      const first = new Date(c.getFullYear(), c.getMonth(), 1);
      const start = calAddDays(first, -first.getDay());
      html = `<div class="cal-grid">${DAYS_SHORT.map((d) => `<div class="cal-dow">${d}</div>`).join("")}`;
      for (let i = 0; i < 42; i++) {
        const d = calAddDays(start, i);
        html += calDayCell(d, byDate, { other: d.getMonth() !== c.getMonth() });
      }
      html += "</div>";
    } else if (CAL.view === "week") {
      const start = calAddDays(c, -c.getDay());
      html = `<div class="cal-grid">${DAYS_SHORT.map((d) => `<div class="cal-dow">${d}</div>`).join("")}`;
      for (let i = 0; i < 7; i++) html += calDayCell(calAddDays(start, i), byDate, { week: true, max: 12 });
      html += "</div>";
    } else if (CAL.view === "day") {
      const list = byDate[calFmt(c)] || [];
      html = list.length
        ? `<div class="cal-agenda-list" style="padding:8px;">${list.map(calChip).join("")}</div>`
        : `<div class="cal-empty">Aa divas ma kai nathi. <a href="#" id="calEmptyAdd">Event add karo</a></div>`;
    } else {
      let any = false;
      for (let i = 0; i < 60; i++) {
        const d = calAddDays(c, i), list = byDate[calFmt(d)] || [];
        if (!list.length) continue;
        any = true;
        html += `<div class="cal-agenda-day"><div class="cal-agenda-date"><b>${d.getDate()}</b><span>${DAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()].slice(0, 3)}</span></div><div class="cal-agenda-list">${list.map(calChip).join("")}</div></div>`;
      }
      if (!any) html = `<div class="cal-empty">Aavta 60 divas ma koi event nathi.</div>`;
    }
    body.innerHTML = html;
  }

  async function renderCalendarView() {
    try {
      const res = await Api.getCalendar();
      CAL.events = res.events || [];
    } catch (err) {
      showToast("Calendar load na thayu: " + err.message, "error");
    }
    drawCalendar();
  }

  function openCalEventModal(ev = null, dateStr = "") {
    CAL.editingId = ev ? ev.id : null;
    $("#calEventModalTitle").textContent = ev ? "Edit Event" : "Add Event";
    $("#calTitleInput").value = ev ? ev.title : "";
    $("#calDateInput").value = ev ? ev.date : (dateStr || calFmt(CAL.cursor));
    $("#calAllDayInput").checked = ev ? !!ev.allDay : true;
    $("#calStartInput").value = ev ? ev.startTime || "" : "";
    $("#calEndInput").value = ev ? ev.endTime || "" : "";
    $("#calNotesInput").value = ev ? ev.notes || "" : "";
    $("#calEventDeleteBtn").hidden = !ev;
    syncCalAllDay();
    $("#calEventOverlay").hidden = false;
    $("#calTitleInput").focus();
  }
  function closeCalEventModal() { $("#calEventOverlay").hidden = true; CAL.editingId = null; }
  function syncCalAllDay() {
    const allDay = $("#calAllDayInput").checked;
    $("#calStartWrap").style.display = allDay ? "none" : "";
    $("#calEndWrap").style.display = allDay ? "none" : "";
  }

  function openCalDetail(ev) {
    $("#calDetailTitle").textContent = ev.title;
    const rows = [
      ["Type", CAL_TYPE_LABEL[ev.type] || ev.type],
      ["Date", ev.date],
      ev.clientName ? ["Client", ev.clientName + (ev.clientId ? ` (${ev.clientId})` : "")] : null,
      ev.notes ? ["Notes", ev.notes] : null
    ].filter(Boolean);
    $("#calDetailBody").innerHTML =
      rows.map(([k, v]) => `<div class="cal-detail-row"><b>${k}</b><span>${escapeHtml(v)}</span></div>`).join("") +
      `<div class="modal-footer"><button type="button" class="btn btn-primary" id="calDetailOpen">Open ${CAL_LINK_LABEL[ev.link] || ""}</button></div>`;
    $("#calDetailOpen").onclick = () => {
      $("#calDetailOverlay").hidden = true;
      window.location.hash = ev.link;
      setActiveView(ev.link);
    };
    $("#calDetailOverlay").hidden = false;
  }

  function initCalendar() {
    $("#calAddBtn")?.addEventListener("click", () => openCalEventModal(null));
    $("#calTodayBtn")?.addEventListener("click", () => { CAL.cursor = new Date(); drawCalendar(); });
    const step = (dir) => {
      const c = new Date(CAL.cursor);
      if (CAL.view === "month") c.setMonth(c.getMonth() + dir, 1);
      else if (CAL.view === "week") c.setDate(c.getDate() + 7 * dir);
      else if (CAL.view === "day") c.setDate(c.getDate() + dir);
      else c.setDate(c.getDate() + 30 * dir);
      CAL.cursor = c;
      drawCalendar();
    };
    $("#calPrevBtn")?.addEventListener("click", () => step(-1));
    $("#calNextBtn")?.addEventListener("click", () => step(1));
    $$("#calViews button").forEach((b) => b.addEventListener("click", () => { CAL.view = b.dataset.calview; drawCalendar(); }));
    $$("#calLegend .cal-leg").forEach((b) => b.addEventListener("click", () => {
      const t = b.dataset.type;
      CAL.hidden.has(t) ? CAL.hidden.delete(t) : CAL.hidden.add(t);
      b.classList.toggle("on", !CAL.hidden.has(t));
      drawCalendar();
    }));

    $("#calBody")?.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-evid]");
      if (chip) {
        const ev = CAL.events.find((x) => x.id === chip.dataset.evid);
        if (!ev) return;
        ev.source === "manual" ? openCalEventModal(ev) : openCalDetail(ev);
        return;
      }
      const more = e.target.closest("[data-gotoday]");
      if (more) { CAL.cursor = calParse(more.dataset.gotoday); CAL.view = "day"; drawCalendar(); return; }
      if (e.target.id === "calEmptyAdd") { e.preventDefault(); openCalEventModal(null, calFmt(CAL.cursor)); return; }
      const cell = e.target.closest("[data-date]");
      if (cell) openCalEventModal(null, cell.dataset.date);
    });

    $("#calAllDayInput")?.addEventListener("change", syncCalAllDay);
    $("#calEventClose")?.addEventListener("click", closeCalEventModal);
    $("#calEventCancelBtn")?.addEventListener("click", closeCalEventModal);
    $("#calDetailClose")?.addEventListener("click", () => { $("#calDetailOverlay").hidden = true; });

    $("#calEventForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = {
        title: $("#calTitleInput").value.trim(),
        date: $("#calDateInput").value,
        allDay: $("#calAllDayInput").checked,
        startTime: $("#calStartInput").value,
        endTime: $("#calEndInput").value,
        notes: $("#calNotesInput").value.trim()
      };
      try {
        if (CAL.editingId) await Api.updateCalendarEvent(CAL.editingId, payload);
        else await Api.createCalendarEvent(payload);
        closeCalEventModal();
        showToast("Event saved", "success");
        await renderCalendarView();
      } catch (err) {
        showToast("Save na thayu: " + err.message, "error");
      }
    });

    $("#calEventDeleteBtn")?.addEventListener("click", () => {
      const id = CAL.editingId;
      if (!id) return;
      openConfirm("Delete this event?", "Aa event kayam mate delete thai jase.", async () => {
        try {
          await Api.deleteCalendarEvent(id);
          closeCalEventModal();
          showToast("Event deleted", "success");
          await renderCalendarView();
        } catch (err) {
          showToast("Delete na thayu: " + err.message, "error");
        }
      });
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

  function clientsLayout() {
    try { return localStorage.getItem("aos_clients_layout") === "list" ? "list" : "card"; } catch (_) { return "card"; }
  }

  function renderClientGrid(clients) {
    const grid = $("#clientGrid");
    const layout = clientsLayout();
    grid.classList.toggle("is-list", layout === "list");
    $$("#clientLayoutToggle button").forEach((b) => b.classList.toggle("active", b.dataset.layout === layout));
    if (!clients.length) {
      grid.innerHTML = `<p style="color:var(--text-muted);">No clients yet.</p>`;
      return;
    }

    if (layout === "list") {
      grid.innerHTML = `<div class="card table-card"><div class="table-scroll"><table class="data-table client-table">
        <thead><tr>
          <th>Client</th><th>Mobile</th><th>Business Name</th>
          <th class="cl-money">Total Business</th><th class="cl-money">Received</th><th class="cl-money">Pending</th><th class="cl-money">Payments</th><th></th>
        </tr></thead>
        <tbody>${clients.map((c, idx) => `
          <tr class="client-row" data-index="${idx}">
            <td><div class="client-cell">
              <div class="client-avatar sm">${initials(c.clientName)}</div>
              <div><b>${escapeHtml(c.clientName)}</b>${c.clientId ? `<div class="client-id">${escapeHtml(c.clientId)}</div>` : ""}</div>
            </div></td>
            <td>${escapeHtml(c.mobile || "—")}</td>
            <td>${escapeHtml(c.businessName || "—")}</td>
            <td class="cell-amount cl-money">${fmtMoney(c.totalBusiness)}</td>
            <td class="cell-amount amount-paid cl-money">${fmtMoney(c.totalReceived)}</td>
            <td class="cell-amount amount-pending cl-money">${fmtMoney(c.totalPending)}</td>
            <td class="cl-money">${Number(c.paymentsCount) || 0}</td>
            <td class="client-row-go"><i class="fa-solid fa-chevron-right"></i></td>
          </tr>`).join("")}
        </tbody></table></div></div>`;
      $$(".client-row").forEach((row) => {
        row.addEventListener("click", () => openClientDrawer(clients[Number(row.dataset.index)]));
      });
      return;
    }

    grid.innerHTML = clients.map((c, idx) => `
      <div class="client-card" data-index="${idx}">
        <div class="client-card-head">
          <div class="client-avatar">${initials(c.clientName)}</div>
          <div>
            <h4>${escapeHtml(c.clientName)}</h4>
            ${c.clientId ? `<span class="client-id">${escapeHtml(c.clientId)}</span>` : ""}
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

  function currentClientFilter() {
    const search = ($("#clientSearch").value || "").toLowerCase();
    return state.clients.filter((c) =>
      [c.clientId, c.clientName, c.mobile, c.businessName, c.instagram].some((f) => (f || "").toLowerCase().includes(search))
    );
  }

  function initClientSearch() {
    $("#clientSearch").addEventListener("input", debounce(() => {
      renderClientGrid(currentClientFilter());
    }, 200));

    $("#clientLayoutToggle").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-layout]");
      if (!b) return;
      try { localStorage.setItem("aos_clients_layout", b.dataset.layout); } catch (_) {}
      renderClientGrid(currentClientFilter());
    });

    $("#clientFilterMonth").addEventListener("change", async () => {
      state.clientsFilterMonth = $("#clientFilterMonth").value;
      await renderClientsView();
    });
  }

  async function openClientDrawer(client) {
    state.currentClient = client;
    state.currentClientKey = client.clientId || client.mobile || client.clientName;
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
    const profileKey = client.clientId || client.mobile || client.clientName;
    const profile = state.clientProfiles[profileKey]
      || state.clientProfiles[client.mobile || client.clientName]
      || { location: "", folderPath: "" };
    $("#clientDrawerHeader").innerHTML = `
      <div class="client-stats" style="border-top:none; padding-top:0; margin-bottom:14px;">
        <div><span class="cs-label">Business</span><span class="cs-value">${fmtMoney(client.totalBusiness)}</span></div>
        <div><span class="cs-label">Received</span><span class="cs-value">${fmtMoney(client.totalReceived)}</span></div>
        <div><span class="cs-label">Pending</span><span class="cs-value">${fmtMoney(client.totalPending)}</span></div>
      </div>
      <p style="font-size:13px; color:var(--text-muted); margin-bottom:14px;">
        <b>Client ID:</b> ${escapeHtml(client.clientId || "—")} &nbsp;·&nbsp;
        <b>Mobile:</b> ${escapeHtml(client.mobile || "—")} &nbsp;·&nbsp;
        <b>Instagram:</b> ${escapeHtml(client.instagram || "—")}
      </p>
      <div class="drawer-section" style="margin-bottom:14px;">
        <div class="drawer-section-head"><h3>Contact Details</h3></div>
        <div class="inline-form" style="flex-direction:column; align-items:stretch;">
          <input type="text" id="cdName" placeholder="Client name" value="${escapeHtml(client.clientName || "")}" />
          <input type="text" id="cdMobile" placeholder="Mobile number" value="${escapeHtml(client.mobile || "")}" />
          <input type="text" id="cdBusiness" placeholder="Business name" value="${escapeHtml(client.businessName || "")}" />
          <input type="text" id="cdInstagram" placeholder="Instagram" value="${escapeHtml(client.instagram || "")}" />
          <button type="button" class="btn btn-primary btn-sm" id="saveClientDetailsBtn" style="align-self:flex-start;">
            <i class="fa-solid fa-check"></i> Save Contact
          </button>
          <small style="color:var(--text-muted);">Mobile badlo to pan Client ID (${escapeHtml(client.clientId || "—")}) same rehse.</small>
        </div>
      </div>
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
    $("#saveClientDetailsBtn")?.addEventListener("click", async () => {
      if (!client.clientId) {
        showToast("Client ID nathi, page refresh karo", "error");
        return;
      }
      try {
        const updated = await Api.updateClientDetails(client.clientId, {
          clientName: $("#cdName").value.trim(),
          mobile: $("#cdMobile").value.trim(),
          businessName: $("#cdBusiness").value.trim(),
          instagram: $("#cdInstagram").value.trim()
        });
        state.currentClient = { ...client, ...updated };
        state.currentClientKey = updated.clientId || client.clientId;
        state.payments = await Api.getPayments();
        $("#clientDrawerTitle").textContent = state.currentClient.clientName;
        renderClientDrawerHeader(state.currentClient);
        await refreshClientTabData();
        await refreshClientsGridIfVisible();
        showToast("Contact details saved", "success");
      } catch (err) {
        showToast("Failed to save: " + err.message, "error");
      }
    });

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
    const period = readPeriod($("#reportPeriod"), $("#reportFrom"), $("#reportTo"));
    if (!period) return;
    try {
      const [report, topClients] = await Promise.all([Api.getReport(type, status, period.from, period.to), Api.getTopClients(period.from, period.to)]);
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
    // Reports now refresh by themselves whenever a filter changes.
    $("#reportType").addEventListener("change", runReport);
    $("#reportStatus").addEventListener("change", runReport);
    wirePeriodSelect($("#reportPeriod"), $("#reportCustomRange"), $("#reportFrom"), $("#reportTo"), runReport);
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

  /* ============ Separate PDF reports: Expenses / Pending / Received ============ */
  const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // ---- Shared period picker (used by Reports and PDF Reports) ----
  function populatePeriodSelect(sel, defaultValue) {
    if (!sel) return;
    const keep = sel.value || defaultValue;
    const now = new Date();
    const curKey = currentMonthKey();
    const prevKey = isoLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
    const nice = (key) => monthLabel(key).replace(" (Current)", "");
    const months = new Set();
    state.payments.forEach((p) => p.date && months.add(String(p.date).slice(0, 7)));
    state.expenses.forEach((e) => e.date && months.add(String(e.date).slice(0, 7)));
    // Current and last month already have their own entries, so don't repeat them below.
    const others = [...months].filter((k) => k && k !== curKey && k !== prevKey).sort().reverse();
    sel.innerHTML =
      `<option value="all">All Time</option>` +
      `<option value="this-month">This Month (${escapeHtml(nice(curKey))})</option>` +
      `<option value="last-month">Last Month (${escapeHtml(nice(prevKey))})</option>` +
      `<option value="last-90">Last 3 Months</option>` +
      `<option value="this-fy">This Financial Year (Apr–Mar)</option>` +
      `<option value="this-year">This Calendar Year</option>` +
      (others.length ? `<optgroup label="Other months">${others.map((k) => `<option value="m:${k}">${escapeHtml(nice(k))}</option>`).join("")}</optgroup>` : "") +
      `<option value="custom">Custom Range (From – To)…</option>`;
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : defaultValue;
  }

  // Returns { from, to, label } ("" = open-ended) or null when the custom range is invalid.
  function readPeriod(sel, fromEl, toEl) {
    const v = sel?.value || "all";
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const nice = (key) => monthLabel(key).replace(" (Current)", "");
    const mk = (from, to, label) => ({ from, to, label: label || `${fmtDate(from)} – ${fmtDate(to)}` });

    if (v === "all") return { from: "", to: "", label: "All Time" };
    if (v === "this-month") return mk(isoLocal(new Date(y, m, 1)), isoLocal(new Date(y, m + 1, 0)), nice(currentMonthKey()));
    if (v === "last-month") return mk(isoLocal(new Date(y, m - 1, 1)), isoLocal(new Date(y, m, 0)), nice(isoLocal(new Date(y, m - 1, 1)).slice(0, 7)));
    if (v === "last-90") return mk(isoLocal(new Date(y, m - 2, 1)), isoLocal(new Date(y, m + 1, 0)));
    if (v === "this-year") return mk(`${y}-01-01`, `${y}-12-31`);
    if (v === "this-fy") {
      const startYear = m >= 3 ? y : y - 1;
      return mk(`${startYear}-04-01`, `${startYear + 1}-03-31`);
    }
    if (v.startsWith("m:")) {
      const [yy, mm] = v.slice(2).split("-").map(Number);
      return mk(isoLocal(new Date(yy, mm - 1, 1)), isoLocal(new Date(yy, mm, 0)), nice(v.slice(2)));
    }
    const from = fromEl?.value || "", to = toEl?.value || "";
    if (!from && !to) { showToast("From ane To date pasand karo", "error"); return null; }
    if (from && to && from > to) { showToast("From date, To date karta moti na hovi joie", "error"); return null; }
    return { from, to, label: `${from ? fmtDate(from) : "Start"} – ${to ? fmtDate(to) : "Today"}` };
  }

  // Show/hide the From/To boxes when "Custom Range" is chosen; fill sensible defaults.
  function wirePeriodSelect(sel, rangeBox, fromEl, toEl, onChange) {
    sel?.addEventListener("change", () => {
      const custom = sel.value === "custom";
      rangeBox.style.display = custom ? "flex" : "none";
      if (custom && !fromEl.value && !toEl.value) {
        const now = new Date();
        fromEl.value = isoLocal(new Date(now.getFullYear(), now.getMonth(), 1));
        toEl.value = isoLocal(now);
      }
      if (onChange) onChange();
    });
    [fromEl, toEl].forEach((el) => el?.addEventListener("change", () => { if (sel.value === "custom" && onChange) onChange(); }));
  }

  function populatePdfMonthSelect() {
    populatePeriodSelect($("#pdfMonthSelect"), "this-month");
    $("#pdfCustomRange").style.display = $("#pdfMonthSelect").value === "custom" ? "flex" : "none";
  }
  function getPdfRange() {
    return readPeriod($("#pdfMonthSelect"), $("#pdfFrom"), $("#pdfTo"));
  }

  function makeReportPdf({ title, range, head, body, foot, color, footColor, filename, summary, onCell, landscape, columnStyles }) {
    if (typeof window.jspdf === "undefined") { showToast("PDF library load nathi thayi", "error"); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF(landscape ? { orientation: "landscape" } : undefined);
    const company = state.settings.companyName || "PayFlow";
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(`${company} — ${title}`, 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`${range.label}  •  ${body.length} ${body.length === 1 ? "record" : "records"}  •  Generated ${new Date().toLocaleString("en-IN")}`, 14, 22);
    doc.setTextColor(20);

    let y = 28;
    if (summary && summary.length) {
      doc.setFontSize(10);
      summary.forEach(([k, v], i) => {
        doc.setTextColor(110);
        doc.text(k, 14 + i * 62, y + 2);
        doc.setTextColor(20);
        doc.setFont(undefined, "bold");
        doc.text(v, 14 + i * 62, y + 8);
        doc.setFont(undefined, "normal");
      });
      y += 16;
    }

    doc.autoTable({
      head: [head],
      body,
      foot: [foot],
      startY: y,
      styles: { fontSize: 8.5, cellPadding: 3.5, overflow: "linebreak" },
      headStyles: { fillColor: color, textColor: 255, fontStyle: "bold" },
      footStyles: { fillColor: footColor, textColor: 20, fontStyle: "bold" },
      alternateRowStyles: { fillColor: [248, 250, 250] },
      columnStyles: columnStyles || {},
      margin: { left: 14, right: 14 },
      didParseCell: onCell,
      didDrawPage: () => {
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Page ${doc.internal.getCurrentPageInfo().pageNumber}`, 14, doc.internal.pageSize.height - 8);
      }
    });
    doc.save(filename);
    showToast("PDF downloaded", "success");
  }

  function initPdfReports() {
    const pdfMoney = (n) => "Rs. " + (Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    const inRange = (d, r) => {
      const day = String(d || "").slice(0, 10);
      if (!day) return !r.from && !r.to;
      return (!r.from || day >= r.from) && (!r.to || day <= r.to);
    };
    const sum = (arr, f) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
    const fileSuffix = (r) => (!r.from && !r.to ? "all-time" : `${r.from || "start"}_to_${r.to || "today"}`);

    wirePeriodSelect($("#pdfMonthSelect"), $("#pdfCustomRange"), $("#pdfFrom"), $("#pdfTo"));

    $("#pdfExpensesBtn")?.addEventListener("click", () => {
      const range = getPdfRange();
      if (!range) return;
      const rows = state.expenses.filter((e) => inRange(e.date, range)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (!rows.length) { showToast("Aa period ma koi expense nathi", "error"); return; }
      const total = sum(rows, (e) => e.amount);
      const byCat = {};
      rows.forEach((e) => { byCat[e.category || "Other"] = (byCat[e.category || "Other"] || 0) + (Number(e.amount) || 0); });
      const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0];
      makeReportPdf({
        title: "Expenses", range,
        head: ["Date", "Category", "Amount", "Notes"],
        body: rows.map((e) => [fmtDate(e.date), e.category || "—", pdfMoney(e.amount), e.notes || "—"]),
        foot: ["", "Total", pdfMoney(total), ""],
        color: [200, 70, 80], footColor: [250, 232, 233],
        summary: [["Total Expenses", pdfMoney(total)], ["Entries", String(rows.length)], ["Top Category", top ? `${top[0]} (${pdfMoney(top[1])})` : "—"]],
        filename: `expenses-${fileSuffix(range)}.pdf`
      });
    });

    $("#pdfPendingBtn")?.addEventListener("click", () => {
      const range = getPdfRange();
      if (!range) return;
      const today = isoLocal(new Date());
      const rows = state.payments
        .filter((p) => (Number(p.pendingAmount) || 0) > 0 && inRange(p.date, range))
        .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
      if (!rows.length) { showToast("Aa period ma koi pending payment nathi", "error"); return; }
      const overdue = rows.filter((p) => p.dueDate && p.dueDate < today);
      makeReportPdf({
        title: "Pending Payments", range,
        landscape: true,
        columnStyles: { 3: { cellWidth: 70 } },
        head: ["Client", "Mobile", "Category", "Work Details", "Total", "Paid", "Pending", "Due Date"],
        body: rows.map((p) => [p.clientName || "—", p.mobile || "—", p.category || "—", p.workDetails || p.notes || "—", pdfMoney(p.totalAmount), pdfMoney(p.paidAmount), pdfMoney(p.pendingAmount), p.dueDate ? fmtDate(p.dueDate) : "—"]),
        foot: ["", "", "", "Total", pdfMoney(sum(rows, (p) => p.totalAmount)), pdfMoney(sum(rows, (p) => p.paidAmount)), pdfMoney(sum(rows, (p) => p.pendingAmount)), ""],
        color: [221, 154, 46], footColor: [253, 243, 226],
        summary: [["Total Pending", pdfMoney(sum(rows, (p) => p.pendingAmount))], ["Entries", String(rows.length)], ["Overdue", `${overdue.length} (${pdfMoney(sum(overdue, (p) => p.pendingAmount))})`]],
        filename: `pending-payments-${fileSuffix(range)}.pdf`,
        onCell: (hd) => {
          if (hd.section !== "body") return;
          const p = rows[hd.row.index];
          if (p && p.dueDate && p.dueDate < today && (hd.column.index === 7 || hd.column.index === 6)) {
            hd.cell.styles.textColor = [200, 60, 60];
            hd.cell.styles.fontStyle = "bold";
          }
        }
      });
    });

    $("#pdfReceivedBtn")?.addEventListener("click", () => {
      const range = getPdfRange();
      if (!range) return;
      const rows = state.payments
        .filter((p) => (Number(p.paidAmount) || 0) > 0 && inRange(p.date, range))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      if (!rows.length) { showToast("Aa period ma koi received payment nathi", "error"); return; }
      makeReportPdf({
        title: "Received Payments", range,
        landscape: true,
        columnStyles: { 4: { cellWidth: 65 } },
        head: ["Date", "Client", "Business", "Category", "Work Details", "Total", "Received", "Status"],
        body: rows.map((p) => [fmtDate(p.date), p.clientName || "—", p.businessName || "—", p.category || "—", p.workDetails || p.notes || "—", pdfMoney(p.totalAmount), pdfMoney(p.paidAmount), p.status || "—"]),
        foot: ["", "", "", "", "Total", pdfMoney(sum(rows, (p) => p.totalAmount)), pdfMoney(sum(rows, (p) => p.paidAmount)), ""],
        color: [18, 117, 108], footColor: [230, 240, 239],
        summary: [["Total Received", pdfMoney(sum(rows, (p) => p.paidAmount))], ["Entries", String(rows.length)], ["Still Pending", pdfMoney(sum(rows, (p) => p.pendingAmount))]],
        filename: `received-payments-${fileSuffix(range)}.pdf`
      });
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
      window.location.href = "/logout";
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
    const clients = state.pickerClients.filter((c) =>
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
    state.currentClientKey = client.clientId || client.mobile || client.clientName;
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
    try {
      state.pickerClients = await Api.getClients("all");
    } catch (err) {
      state.pickerClients = buildClientsFromPayments(state.payments);
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

  /* ================================================================== */
  /* Packages → Design & Reel                                           */
  /* Page 1: package list.  Page 2: package detail with 6 tabs.         */
  /* Package = what the client bought. Work = what the team produces.   */
  /* ================================================================== */
  const PK_STATUSES = ["Upcoming", "Active", "On Hold", "Completed", "Expired", "Cancelled"];
  const PK_CYCLES = ["Monthly", "Quarterly", "Half-Yearly", "Yearly", "One-time"];
  const PK_PER = { Monthly: "Month", Quarterly: "Quarter", "Half-Yearly": "6 Months", Yearly: "Year", "One-time": "" };
  const PK_DELIV_CYCLES = ["Month", "Week", "Quarter", "Year", "Total"];
  const PK_WORK_STATUSES = ["Pending", "In Progress", "Completed"];
  const PK_KINDS = {
    post: { key: "posts", label: "Post", plural: "Posts", assignLabel: "Assigned To", dateKey: "plannedDate", dateLabel: "Planned Date" },
    reel: { key: "reels", label: "Reel", plural: "Reels", assignLabel: "Assigned Editor", dateKey: "shootDate", dateLabel: "Shoot Date" },
    story: { key: "stories", label: "Story", plural: "Stories", assignLabel: "Assigned To", dateKey: null, dateLabel: "" }
  };
  const PK_ACTION_LABEL = {
    create: "Created", update: "Updated", delete: "Deleted",
    work_post: "Work added", work_put: "Work updated", work_delete: "Work removed",
    payment_added: "Payment", payment_removed: "Payment"
  };

  const PK = {
    list: [], clients: [], current: null, tab: "overview",
    filters: { q: "", client: "", status: "", type: "", manager: "", from: "", to: "" },
    editingId: null, workKind: "post", editingWorkId: null
  };

  const canFull = (m) => !!(state.me && state.me.access && state.me.access[m] === "full");
  const pkStatusClass = (s) => "pk-st-" + String(s || "").toLowerCase().replace(/\s+/g, "-");
  const pkTodayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const pkAmountLabel = (p) => {
    if (!can("payments")) return "—";
    const per = PK_PER[p.billingCycle || "Monthly"];
    return fmtMoney(p.totalAmount) + (per ? ` / ${per}` : "");
  };
  const pkOpts = (list, selected, blank) =>
    (blank !== undefined ? `<option value="">${escapeHtml(blank)}</option>` : "") +
    list.map((v) => `<option value="${escapeHtml(v)}" ${v === selected ? "selected" : ""}>${escapeHtml(v)}</option>`).join("");

  async function renderPackagesView(arg) {
    const listPage = $("#pkListPage");
    const detail = $("#pkDetailPage");
    if (!listPage || !detail) return;
    try {
      PK.list = (await Api.getPackages()).filter((p) => p.type !== "Management");
    } catch (err) {
      PK.list = [];
      showToast("Packages load na thaya: " + err.message, "error");
    }
    if (arg) {
      const pkg = PK.list.find((p) => p.id === arg);
      if (!pkg) {
        showToast("Package malyu nahi", "error");
        window.location.hash = "packages";
        return;
      }
      PK.current = pkg;
      listPage.hidden = true;
      detail.hidden = false;
      renderPkDetail();
      return;
    }
    PK.current = null;
    detail.hidden = true;
    listPage.hidden = false;
    $("#pkAddBtn").style.display = canFull("payments") ? "" : "none";
    if (can("clients")) {
      try { PK.clients = await Api.getClients("all"); } catch (_) { PK.clients = []; }
    }
    renderPkFilters();
    renderPkList();
  }

  /* ------------------------- Page 1: list -------------------------- */
  function pkFiltered() {
    const f = PK.filters;
    const q = f.q.trim().toLowerCase();
    return PK.list.filter((p) => {
      if (q && ![p.clientName, p.clientId, p.name, p.id].some((v) => (v || "").toLowerCase().includes(q))) return false;
      if (f.client && (p.clientId || p.clientName) !== f.client) return false;
      if (f.status && p.status !== f.status) return false;
      if (f.type && (p.billingCycle || "Monthly") !== f.type) return false;
      if (f.manager && (p.accountManager || "") !== f.manager) return false;
      if (f.from && (p.startDate || "") < f.from) return false;
      if (f.to && (p.startDate || "") > f.to) return false;
      return true;
    });
  }

  function renderPkFilters() {
    const f = PK.filters;
    const clients = new Map();
    PK.list.forEach((p) => clients.set(p.clientId || p.clientName, p.clientName));
    $("#pkFilterClient").innerHTML = `<option value="">All Clients</option>` +
      [...clients.entries()].map(([k, n]) => `<option value="${escapeHtml(k)}" ${k === f.client ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
    $("#pkStatusChips").innerHTML = ["", ...PK_STATUSES].map((st) =>
      `<button type="button" class="chip ${st === f.status ? "active" : ""}" data-pk-status="${escapeHtml(st)}">${st || "All"}</button>`).join("");
    $("#pkFilterType").innerHTML = pkOpts(PK_CYCLES, f.type, "All Types");
    const managers = [...new Set(PK.list.map((p) => p.accountManager).filter(Boolean))];
    $("#pkFilterManager").innerHTML = pkOpts(managers, f.manager, "All Managers");
    $("#pkSearch").value = f.q;
    $("#pkFilterFrom").value = f.from;
    $("#pkFilterTo").value = f.to;
  }

  // Per-type progress (Posts / Reels / Stories) + one-click "log 1 done today"
  function pkMiniBars(p) {
    const pr = p.progress || {};
    const quick = canFull("calendar") && p.status !== "Cancelled";
    return `<div class="pk-mini">${["post", "reel", "story"].map((k) => {
      const kk = PK_KINDS[k];
      const c = pr[kk.key] || { total: 0, done: 0, percent: 0 };
      if (!c.total) return "";
      return `<div class="pk-mini-row">
        <span class="pk-mini-label">${kk.plural}</span>
        <div class="progress-bar"><div class="progress-fill" style="width:${c.percent}%"></div></div>
        <span class="pk-mini-count">${c.done}/${c.total}</span>
        ${quick ? `<button type="button" class="pk-log-btn" title="Log 1 ${kk.label.toLowerCase()} done today" data-pk-log="${escapeHtml(p.id)}" data-kind="${k}"><i class="fa-solid fa-plus"></i></button>` : ""}
      </div>`;
    }).join("")}</div>`;
  }

  // One click = 1 completed work item dated today.
  async function pkQuickLog(pkgId, kind) {
    const kk = PK_KINDS[kind];
    try {
      const updated = await Api.addPackageWork(pkgId, { kind, status: "Completed" });
      const i = PK.list.findIndex((x) => x.id === updated.id);
      if (i > -1) PK.list[i] = updated;
      if (PK.current && PK.current.id === updated.id) PK.current = updated;
      const c = updated.progress[kk.key];
      showToast(`${kk.label} logged for ${updated.clientName} — ${c.done}/${c.total}`, "success");
      if (PK.current) renderPkDetail(); else renderPkList();
    } catch (err) {
      showToast("Log na thayu: " + err.message, "error");
    }
  }

  function renderPkList() {
    const rows = pkFiltered();
    $("#pkEmpty").hidden = rows.length > 0;
    $("#pkTableBody").innerHTML = rows.map((p) => {
      const pr = p.progress || { percent: 0 };
      return `<tr>
        <td><b>${escapeHtml(p.clientName)}</b><div class="pk-sub">${escapeHtml(p.clientId || "")}</div></td>
        <td><b>${escapeHtml(p.name)}</b><div class="pk-sub">${escapeHtml(p.id)}</div></td>
        <td>${pkMiniBars(p)}</td>
        <td><div>${escapeHtml(fmtDate(p.startDate))}</div><div class="pk-sub">${p.endDate ? escapeHtml(fmtDate(p.endDate)) : "No end date"}</div></td>
        <td class="cell-amount">${escapeHtml(pkAmountLabel(p))}</td>
        <td><div class="pk-prog"><div class="progress-bar"><div class="progress-fill" style="width:${pr.percent}%"></div></div><span>${pr.percent}%</span></div></td>
        <td><span class="pk-status ${pkStatusClass(p.status)}">${escapeHtml(p.status)}</span></td>
        <td><button class="btn btn-outline btn-sm" data-pk-view="${escapeHtml(p.id)}">View</button></td>
      </tr>`;
    }).join("");
  }

  /* ------------------------ Page 2: detail ------------------------- */
  function pkPkgTabs() {
    const tabs = [["overview", "Overview"], ["posts", "Posts"], ["reels", "Reels"], ["stories", "Stories"]];
    if (can("payments")) tabs.push(["finance", "Finance"]);
    if (can("activity")) tabs.push(["activity", "Activity"]);
    return tabs;
  }

  function renderPkDetail() {
    const p = PK.current;
    const tabs = pkPkgTabs();
    if (!tabs.some((t) => t[0] === PK.tab)) PK.tab = "overview";
    const editable = canFull("payments");
    $("#pkDetailPage").innerHTML = `
      <a href="#packages" class="pk-back"><i class="fa-solid fa-arrow-left"></i> Design &amp; Reel Packages</a>
      <div class="view-header pk-detail-head">
        <div>
          <h1>Design &amp; Reel Package</h1>
          <p class="view-subtitle"><b>${escapeHtml(p.clientName)}</b></p>
          <div class="pk-meta">
            <span class="pk-id">${escapeHtml(p.id)}</span>
            <span class="pk-status ${pkStatusClass(p.status)}">${escapeHtml(p.status)}</span>
            <span class="pk-sub">Package Type: ${escapeHtml(p.billingCycle || "Monthly")}</span>
          </div>
        </div>
        ${editable ? `<div class="pk-actions">
          <button class="btn btn-primary" data-pk-act="edit"><i class="fa-solid fa-pen"></i> Edit Package</button>
          <details class="pk-more"><summary class="btn btn-ghost">More <i class="fa-solid fa-chevron-down"></i></summary>
            <div class="pk-more-menu"><button type="button" data-pk-act="delete-pkg"><i class="fa-solid fa-trash"></i> Delete Package</button></div>
          </details></div>` : ""}
      </div>
      <div class="tabs pk-tabs">
        ${tabs.map(([k, l]) => `<button class="tab-btn ${k === PK.tab ? "active" : ""}" data-pk-tab="${k}">${l}</button>`).join("")}
      </div>
      <div id="pkTabBody"></div>`;
    renderPkTab();
  }

  function renderPkTab() {
    const body = $("#pkTabBody");
    if (!body) return;
    $$("#pkDetailPage [data-pk-tab]").forEach((b) => b.classList.toggle("active", b.dataset.pkTab === PK.tab));
    const p = PK.current;
    if (PK.tab === "overview") body.innerHTML = pkOverviewHtml(p);
    else if (PK.tab === "finance") body.innerHTML = pkFinanceHtml(p);
    else if (PK.tab === "activity") { body.innerHTML = `<p class="muted">Loading…</p>`; pkLoadActivity(p); }
    else body.innerHTML = pkWorkTabHtml(p, PK.tab === "posts" ? "post" : PK.tab === "reels" ? "reel" : "story");
  }

  function pkDl(rows) {
    return `<dl class="pk-dl">${rows.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${v === "" || v == null ? "—" : v}</dd></div>`).join("")}</dl>`;
  }

  function pkOverviewHtml(p) {
    const pr = p.progress || { total: 0, done: 0, pending: 0, percent: 0 };
    const info = [
      ["Package Name", escapeHtml(p.name)],
      ["Client", escapeHtml(p.clientName)],
      ["Client ID", escapeHtml(p.clientId)],
      ["Package ID", escapeHtml(p.id)],
      ["Start Date", escapeHtml(fmtDate(p.startDate))],
      ["End Date", p.endDate ? escapeHtml(fmtDate(p.endDate)) : ""],
      ["Billing Cycle", escapeHtml(p.billingCycle || "Monthly")]
    ];
    if (can("payments")) info.push(["Package Amount", escapeHtml(pkAmountLabel(p))]);
    info.push(["Status", `<span class="pk-status ${pkStatusClass(p.status)}">${escapeHtml(p.status)}</span>`],
      ["Account Manager", escapeHtml(p.accountManager)], ["Notes", escapeHtml(p.notes)]);

    const cards = ["post", "reel", "story"].map((k) => {
      const kk = PK_KINDS[k];
      const c = (pr[kk.key]) || { total: 0, done: 0, pending: 0, percent: 0 };
      return `<div class="card pk-deliv-card">
        <span class="pk-deliv-title">${kk.plural.toUpperCase()}</span>
        <b class="pk-deliv-total">${c.total} Total</b>
        <div class="pk-deliv-line"><span>${c.done} Done</span><span>${c.pending} Pending</span></div>
        <div class="progress-bar"><div class="progress-fill" style="width:${c.percent}%"></div></div>
        <span class="pk-sub">${c.percent}% Complete</span>
        ${canFull("calendar") ? `<button type="button" class="btn btn-outline btn-sm pk-log-big" data-pk-act="log-done" data-kind="${k}"><i class="fa-solid fa-plus"></i> Log 1 ${kk.label} done today</button>` : ""}
      </div>`;
    }).join("");

    return `<div class="pk-grid">
        <div class="card pk-card"><h3>Package Information</h3>${pkDl(info)}</div>
        <div class="card pk-card"><h3>Progress Overview</h3>
          <div class="pk-big">${pr.percent}%</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pr.percent}%"></div></div>
          <div class="pk-trio">
            <div><b>${pr.done}</b><span>Completed</span></div>
            <div><b>${pr.pending}</b><span>Pending</span></div>
            <div><b>${pr.total}</b><span>Total</span></div>
          </div>
        </div>
      </div>
      <h3 class="pk-sec">Deliverables Overview</h3>
      <div class="pk-deliv">${cards}</div>`;
  }

  function pkWorkTabHtml(p, kind) {
    const kk = PK_KINDS[kind];
    const c = (p.progress && p.progress[kk.key]) || { total: 0, done: 0, pending: 0 };
    const works = (p.works || []).filter((w) => w.kind === kind);
    const editable = canFull("calendar");
    const cols = [`${kk.label} Name`, kk.assignLabel, "Status"];
    if (kk.dateKey) cols.push(kk.dateLabel);
    cols.push("Due Date", "Completed Date");
    if (editable) cols.push("");
    const rows = works.map((w) => `<tr>
      <td><b>${escapeHtml(w.name)}</b></td>
      <td>${escapeHtml(w.assignedTo) || "—"}</td>
      <td><span class="pk-work ${pkStatusClass(w.status)}">${escapeHtml(w.status)}</span></td>
      ${kk.dateKey ? `<td>${escapeHtml(fmtDate(w[kk.dateKey]))}</td>` : ""}
      <td>${escapeHtml(fmtDate(w.dueDate))}</td>
      <td>${escapeHtml(fmtDate(w.completedDate))}</td>
      ${editable ? `<td class="pk-row-actions">
        ${w.status !== "Completed" ? `<button class="icon-btn-sm" title="Mark completed" data-pk-act="complete-work" data-id="${escapeHtml(w.id)}"><i class="fa-solid fa-check"></i></button>` : ""}
        <button class="icon-btn-sm" title="Edit" data-pk-act="edit-work" data-id="${escapeHtml(w.id)}"><i class="fa-solid fa-pen"></i></button>
        <button class="icon-btn-sm" title="Delete" data-pk-act="delete-work" data-id="${escapeHtml(w.id)}"><i class="fa-solid fa-trash"></i></button>
      </td>` : ""}
    </tr>`).join("");
    return `<div class="card table-card">
      <div class="pk-tab-head">
        <div><h3>${kk.plural}</h3>
          <div class="pk-summary"><span>Total: <b>${c.total}</b></span><span>Completed: <b>${c.done}</b></span><span>Pending: <b>${c.pending}</b></span></div>
        </div>
        ${editable ? `<button class="btn btn-primary btn-sm" data-pk-act="add-work" data-kind="${kind}"><i class="fa-solid fa-plus"></i> Add ${kk.label}</button>` : ""}
      </div>
      <div class="table-scroll"><table class="data-table"><thead><tr>${cols.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody></table></div>
      ${works.length ? "" : `<p class="muted" style="padding:16px 0 2px;">No ${kk.plural.toLowerCase()} added yet. Add each ${kk.label.toLowerCase()} here to track progress.</p>`}
      ${(c.total && works.length < c.total) ? `<p class="muted pk-hint">${works.length} of ${c.total} ${kk.plural.toLowerCase()} are listed in the tracker.</p>` : ""}
    </div>`;
  }

  function pkFinanceHtml(p) {
    const today = pkTodayStr();
    const overdue = p.pendingAmount > 0 && p.endDate && p.endDate < today && p.status !== "Cancelled";
    const hist = (p.paymentHistory || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const rows = hist.map((h) => `<tr>
      <td>${escapeHtml(fmtDate(h.date))}</td>
      <td class="cell-amount amount-paid">${escapeHtml(fmtMoney(h.amount))}</td>
      <td>${escapeHtml(h.method) || "—"}</td>
      <td>${escapeHtml(h.reference) || "—"}</td>
      <td>${escapeHtml(h.addedBy) || "—"}</td>
      <td><span class="pk-work pk-st-completed">Received</span></td>
      ${canFull("payments") ? `<td class="pk-row-actions"><button class="icon-btn-sm" title="Delete" data-pk-act="delete-payment" data-id="${escapeHtml(h.id)}"><i class="fa-solid fa-trash"></i></button></td>` : ""}
    </tr>`).join("");
    return `<div class="pk-fin">
        <div class="card pk-fin-card"><span>Package Amount</span><b>${escapeHtml(pkAmountLabel(p))}</b></div>
        <div class="card pk-fin-card"><span>Paid</span><b class="pk-green">${escapeHtml(fmtMoney(p.paidAmount))}</b></div>
        <div class="card pk-fin-card"><span>Pending</span><b class="pk-red">${escapeHtml(fmtMoney(p.pendingAmount))}</b></div>
        <div class="card pk-fin-card"><span>Payment Status</span><b><span class="badge ${escapeHtml(p.paymentStatus)}">${escapeHtml(p.paymentStatus)}</span></b>
          ${overdue ? `<em class="pk-overdue"><i class="fa-solid fa-triangle-exclamation"></i> Overdue since ${escapeHtml(fmtDate(p.endDate))}</em>` : ""}</div>
      </div>
      <div class="card table-card">
        <div class="pk-tab-head"><h3>Payment Transactions</h3>
          ${canFull("payments") ? `<button class="btn btn-primary btn-sm" data-pk-act="add-payment"><i class="fa-solid fa-plus"></i> Add Payment</button>` : ""}
        </div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th><th>Added By</th><th>Status</th>${canFull("payments") ? "<th></th>" : ""}</tr></thead>
          <tbody>${rows}</tbody></table></div>
        ${hist.length ? "" : `<p class="muted" style="padding:16px 0 2px;">No payments recorded yet.</p>`}
      </div>`;
  }

  function pkActivityText(a) {
    let text = a.summary || "";
    if (a.user_name && text.startsWith(a.user_name + ": ")) text = text.slice(a.user_name.length + 2);
    const ch = a.details && a.details.changes;
    const extra = ch ? Object.entries(ch).map(([k, [o, n]]) =>
      `<div class="pk-sub">${escapeHtml(k)}: ${escapeHtml(o == null || o === "" ? "—" : o)} → ${escapeHtml(n == null || n === "" ? "—" : n)}</div>`).join("") : "";
    return `${escapeHtml(text)}${extra}`;
  }

  async function pkLoadActivity(p) {
    const body = $("#pkTabBody");
    try {
      const rows = await Api.getPackageActivity(p.id);
      if (PK.tab !== "activity" || !PK.current || PK.current.id !== p.id) return;
      body.innerHTML = `<div class="card table-card"><div class="pk-tab-head"><h3>Activity</h3></div>
        <div class="table-scroll"><table class="data-table"><thead><tr><th>Activity</th><th>User</th><th>Date / Time</th><th>Action</th></tr></thead><tbody>
        ${rows.map((a) => `<tr><td>${pkActivityText(a)}</td><td>${escapeHtml(a.user_name || "—")}</td>
          <td>${escapeHtml(new Date(a.at).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }))}</td>
          <td>${escapeHtml(PK_ACTION_LABEL[a.action] || a.action)}</td></tr>`).join("")}
        </tbody></table></div>
        ${rows.length ? "" : `<p class="muted" style="padding:16px 0 2px;">No activity recorded for this package yet.</p>`}</div>`;
    } catch (err) {
      body.innerHTML = `<p class="muted">Activity load na thayu: ${escapeHtml(err.message)}</p>`;
    }
  }

  function pkApply(updated) {
    const i = PK.list.findIndex((x) => x.id === updated.id);
    if (i > -1) PK.list[i] = updated;
    PK.current = updated;
    renderPkDetail();
  }

  /* ----------------------- Add / Edit package ---------------------- */
  function openPkModal(pkg = null) {
    PK.editingId = pkg ? pkg.id : null;
    $("#pkModalTitle").textContent = pkg ? "Edit Package" : "Add Package";
    $("#pkModalSaveText").textContent = pkg ? "Save Changes" : "Create Package";
    $("#pkfId").value = pkg ? pkg.id : "Auto-generated";
    const sel = $("#pkfClient");
    const clients = PK.clients.length ? PK.clients : [];
    if (pkg) {
      sel.innerHTML = `<option value="existing">${escapeHtml(pkg.clientName)}</option>`;
      sel.disabled = true;
      $("#pkfClientId").value = pkg.clientId || "";
    } else {
      sel.disabled = false;
      sel.innerHTML = `<option value="">Select client…</option>` +
        clients.map((c, i) => `<option value="${i}">${escapeHtml(c.clientName)}${c.clientId ? ` (${escapeHtml(c.clientId)})` : ""}</option>`).join("") +
        `<option value="__new__">＋ New client…</option>`;
      $("#pkfClientId").value = "";
    }
    $("#pkfNewClientName").hidden = true;
    $("#pkfNewClientMobile").hidden = true;
    $("#pkfNewName").value = ""; $("#pkfNewMobile").value = "";
    $("#pkfName").value = pkg ? pkg.name : "";
    $("#pkfCycle").innerHTML = pkOpts(PK_CYCLES, pkg ? pkg.billingCycle : "Monthly");
    $("#pkfAmount").value = pkg ? pkg.totalAmount : "";
    $("#pkfAmount").disabled = !can("payments");
    $("#pkfStart").value = pkg ? pkg.startDate : pkTodayStr();
    $("#pkfEnd").value = pkg ? pkg.endDate : "";
    $("#pkfManager").value = pkg ? (pkg.accountManager || "") : "";
    $("#pkfStatus").innerHTML = pkOpts(PK_STATUSES, pkg ? pkg.status : "Active");
    $("#pkfNotes").value = pkg ? pkg.notes : "";
    [["Posts", "posts"], ["Reels", "reels"], ["Stories", "stories"]].forEach(([id, key]) => {
      const d = (pkg && pkg[key]) || { total: 0, cycle: "Month" };
      $(`#pkf${id}`).value = d.total || 0;
      $(`#pkf${id}Cycle`).innerHTML = pkOpts(PK_DELIV_CYCLES, d.cycle || "Month");
    });
    $("#pkModalOverlay").hidden = false;
  }
  const closePkModal = () => { $("#pkModalOverlay").hidden = true; PK.editingId = null; };

  async function submitPkForm(e) {
    e.preventDefault();
    const editing = PK.editingId ? (PK.list.find((p) => p.id === PK.editingId) || PK.current) : null;
    const payload = {
      type: "PostReel",
      name: $("#pkfName").value.trim(),
      billingCycle: $("#pkfCycle").value,
      startDate: $("#pkfStart").value,
      endDate: $("#pkfEnd").value,
      accountManager: $("#pkfManager").value.trim(),
      status: $("#pkfStatus").value,
      notes: $("#pkfNotes").value.trim(),
      posts: { total: Number($("#pkfPosts").value) || 0, cycle: $("#pkfPostsCycle").value },
      reels: { total: Number($("#pkfReels").value) || 0, cycle: $("#pkfReelsCycle").value },
      stories: { total: Number($("#pkfStories").value) || 0, cycle: $("#pkfStoriesCycle").value }
    };
    if (can("payments")) payload.totalAmount = Number($("#pkfAmount").value) || 0;

    if (editing) {
      payload.clientId = editing.clientId;
      payload.clientName = editing.clientName;
      payload.clientMobile = editing.clientMobile;
    } else {
      const v = $("#pkfClient").value;
      if (v === "__new__") {
        payload.clientName = $("#pkfNewName").value.trim();
        payload.clientMobile = $("#pkfNewMobile").value.trim();
        if (!payload.clientName || !payload.clientMobile) { showToast("New client nu naam ane mobile jaruri che", "error"); return; }
      } else if (v === "") {
        showToast("Client pasand karo", "error"); return;
      } else {
        const c = PK.clients[Number(v)];
        payload.clientId = c.clientId || "";
        payload.clientName = c.clientName;
        payload.clientMobile = c.mobile || "";
      }
    }
    try {
      if (editing) {
        const updated = await Api.updatePackage(editing.id, payload);
        showToast("Package updated", "success");
        closePkModal();
        pkApply(updated);
      } else {
        await Api.createPackage(payload);
        showToast("Package created", "success");
        closePkModal();
        await renderPackagesView();
      }
      if (can("payments")) state.payments = await Api.getPayments();
    } catch (err) {
      showToast("Package save na thayu: " + err.message, "error");
    }
  }

  /* ------------------------ Work add / edit ------------------------ */
  function openPkWorkModal(kind, work = null) {
    const kk = PK_KINDS[kind];
    PK.workKind = kind;
    PK.editingWorkId = work ? work.id : null;
    $("#pkWorkTitle").textContent = `${work ? "Edit" : "Add"} ${kk.label}`;
    $("#pkwNameLabel").textContent = `${kk.label} Name *`;
    $("#pkwAssignedLabel").textContent = kk.assignLabel;
    $("#pkwName").value = work ? work.name : "";
    $("#pkwAssigned").value = work ? work.assignedTo : "";
    $("#pkwStatus").innerHTML = pkOpts(PK_WORK_STATUSES, work ? work.status : "Pending");
    $("#pkwPlannedGroup").hidden = !kk.dateKey;
    $("#pkwPlannedLabel").textContent = kk.dateLabel;
    $("#pkwPlanned").value = work && kk.dateKey ? (work[kk.dateKey] || "") : "";
    $("#pkwDue").value = work ? work.dueDate : "";
    $("#pkWorkOverlay").hidden = false;
  }
  const closePkWorkModal = () => { $("#pkWorkOverlay").hidden = true; PK.editingWorkId = null; };

  async function submitPkWork(e) {
    e.preventDefault();
    const kind = PK.workKind;
    const kk = PK_KINDS[kind];
    const payload = {
      kind,
      name: $("#pkwName").value.trim(),
      assignedTo: $("#pkwAssigned").value.trim(),
      status: $("#pkwStatus").value,
      dueDate: $("#pkwDue").value
    };
    if (kk.dateKey) payload[kk.dateKey] = $("#pkwPlanned").value;
    try {
      const updated = PK.editingWorkId
        ? await Api.updatePackageWork(PK.current.id, PK.editingWorkId, payload)
        : await Api.addPackageWork(PK.current.id, payload);
      showToast(`${kk.label} saved`, "success");
      closePkWorkModal();
      pkApply(updated);
    } catch (err) {
      showToast("Save na thayu: " + err.message, "error");
    }
  }

  /* --------------------------- Init / events ------------------------ */
  function initPackagesModule() {
    if (!$("#view-packages")) return;
    const f = PK.filters;
    const bind = (sel, key, ev = "input") => $(sel).addEventListener(ev, (e) => { f[key] = e.target.value; renderPkList(); });
    bind("#pkSearch", "q");
    bind("#pkFilterClient", "client", "change");
    $("#pkStatusChips").addEventListener("click", (e) => {
      const b = e.target.closest("[data-pk-status]");
      if (!b) return;
      f.status = b.dataset.pkStatus;
      $$("#pkStatusChips .chip").forEach((x) => x.classList.toggle("active", x === b));
      renderPkList();
    });
    $("#pkMoreToggle").addEventListener("click", () => { $("#pkMoreFilters").hidden = !$("#pkMoreFilters").hidden; });
    bind("#pkFilterType", "type", "change");
    bind("#pkFilterManager", "manager", "change");
    bind("#pkFilterFrom", "from", "change");
    bind("#pkFilterTo", "to", "change");
    $("#pkFilterReset").addEventListener("click", () => {
      Object.keys(f).forEach((k) => { f[k] = ""; });
      renderPkFilters();
      renderPkList();
    });
    $("#pkAddBtn").addEventListener("click", () => openPkModal());
    $("#pkTableBody").addEventListener("click", (e) => {
      const lg = e.target.closest("[data-pk-log]");
      if (lg) { pkQuickLog(lg.dataset.pkLog, lg.dataset.kind); return; }
      const b = e.target.closest("[data-pk-view]");
      if (b) { PK.tab = "overview"; window.location.hash = "packages/" + b.dataset.pkView; }
    });

    // package modal
    $("#pkModalClose").addEventListener("click", closePkModal);
    $("#pkModalCancel").addEventListener("click", closePkModal);
    $("#pkForm").addEventListener("submit", submitPkForm);
    $("#pkfClient").addEventListener("change", (e) => {
      const v = e.target.value;
      const isNew = v === "__new__";
      $("#pkfNewClientName").hidden = !isNew;
      $("#pkfNewClientMobile").hidden = !isNew;
      $("#pkfClientId").value = !isNew && v !== "" && PK.clients[Number(v)] ? (PK.clients[Number(v)].clientId || "") : "";
      $("#pkfClientId").placeholder = isNew ? "Assigned automatically" : "Select a client";
    });

    // work + payment modals
    $("#pkWorkClose").addEventListener("click", closePkWorkModal);
    $("#pkWorkCancel").addEventListener("click", closePkWorkModal);
    $("#pkWorkForm").addEventListener("submit", submitPkWork);
    const closePay = () => { $("#pkPayOverlay").hidden = true; };
    $("#pkPayClose").addEventListener("click", closePay);
    $("#pkPayCancel").addEventListener("click", closePay);
    $("#pkPayForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const updated = await Api.addPackagePayment(PK.current.id, {
          date: $("#pkpDate").value,
          amount: Number($("#pkpAmount").value) || 0,
          method: $("#pkpMethod").value,
          reference: $("#pkpRef").value.trim(),
          note: $("#pkpNote").value.trim(),
          type: "Payment"
        });
        closePay();
        showToast("Payment added", "success");
        pkApply(updated);
        state.payments = await Api.getPayments();
      } catch (err) {
        showToast("Payment add na thayu: " + err.message, "error");
      }
    });

    // detail page (event delegation)
    $("#pkDetailPage").addEventListener("click", async (e) => {
      const tab = e.target.closest("[data-pk-tab]");
      if (tab) { PK.tab = tab.dataset.pkTab; renderPkTab(); return; }
      const btn = e.target.closest("[data-pk-act]");
      if (!btn || !PK.current) return;
      const p = PK.current;
      const act = btn.dataset.pkAct;
      const workOf = () => (p.works || []).find((w) => w.id === btn.dataset.id);
      if (act === "edit") openPkModal(p);
      else if (act === "log-done") pkQuickLog(p.id, btn.dataset.kind);
      else if (act === "add-work") openPkWorkModal(btn.dataset.kind);
      else if (act === "edit-work") { const w = workOf(); if (w) openPkWorkModal(w.kind, w); }
      else if (act === "complete-work") {
        try { pkApply(await Api.updatePackageWork(p.id, btn.dataset.id, { status: "Completed" })); showToast("Marked completed", "success"); }
        catch (err) { showToast("Update na thayu: " + err.message, "error"); }
      } else if (act === "delete-work") {
        const w = workOf();
        openConfirm("Delete " + (w ? PK_KINDS[w.kind].label : "item"), "Aa record delete karvo che?", async () => {
          try { pkApply(await Api.deletePackageWork(p.id, btn.dataset.id)); showToast("Deleted", "success"); }
          catch (err) { showToast("Delete na thayu: " + err.message, "error"); }
        });
      } else if (act === "add-payment") {
        $("#pkPayForm").reset();
        $("#pkpDate").value = pkTodayStr();
        $("#pkPayOverlay").hidden = false;
      } else if (act === "delete-payment") {
        openConfirm("Delete Payment", "Aa payment entry delete karvi che?", async () => {
          try {
            pkApply(await Api.deletePackagePayment(p.id, btn.dataset.id));
            state.payments = await Api.getPayments();
            showToast("Payment deleted", "success");
          } catch (err) { showToast("Delete na thayu: " + err.message, "error"); }
        });
      } else if (act === "delete-pkg") {
        openConfirm("Delete Package", "Aa package ane tena badha records delete karvu che?", async () => {
          try {
            await Api.deletePackage(p.id);
            showToast("Package deleted", "success");
            if (can("payments")) state.payments = await Api.getPayments();
            window.location.hash = "packages";
          } catch (err) { showToast("Delete na thayu: " + err.message, "error"); }
        });
      }
    });
  }

  /* ====================== Content Production ====================== */
  const CP_STAGES = ["Shoot Planned", "Assigned to Editor", "Upload", "Completed"];
  const CP_STAGE_NEXT = { "Shoot Planned": "Assigned to Editor", "Assigned to Editor": "Upload", "Upload": "Completed" };
  let cpItems = [];
  let cpLoaded = false;
  let cpEditingId = null;

  function cpToday(offset = 0) { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
  function cpStageClass(stage) { return ({"Shoot Planned":"cp-stage-shoot","Assigned to Editor":"cp-stage-editor","Upload":"cp-stage-upload","Completed":"cp-stage-done"}[stage] || "cp-stage-default"); }
  function cpPriorityClass(p) { return ({Urgent:"cp-priority-urgent",High:"cp-priority-high",Normal:"cp-priority-normal",Low:"cp-priority-low"}[p] || "cp-priority-normal"); }
  function cpFiltered() {
    const q = (($("#cpSearch")?.value || "").trim().toLowerCase());
    const stage = $("#cpStageFilter")?.value || "all";
    const type = $("#cpTypeFilter")?.value || "all";
    const platform = $("#cpPlatformFilter")?.value || "all";
    const priority = $("#cpPriorityFilter")?.value || "all";
    return cpItems.filter(x => (!q || [x.id,x.clientName,x.clientMobile,x.contentTitle,x.editor,x.shootBy,x.shootCategory,x.notes].some(v => String(v||"").toLowerCase().includes(q))) && (stage === "all" || x.stage === stage) && (type === "all" || x.type === type) && (platform === "all" || x.platform === platform) && (priority === "all" || x.priority === priority));
  }
  function renderContentProductionView() {
    if (!$("#view-content-production")) return;
    if (!cpLoaded) { loadContentProduction(); return; }
    const rows = cpFiltered();
    $("#cpStatTotal").textContent = cpItems.length;
    $("#cpStatShoot").textContent = cpItems.filter(x=>x.stage === "Shoot Planned").length;
    $("#cpStatEditor").textContent = cpItems.filter(x=>x.stage === "Assigned to Editor").length;
    $("#cpStatCompleted").textContent = cpItems.filter(x=>x.stage === "Completed").length;
    $("#cpResultCount").textContent = `${rows.length} record${rows.length===1?"":"s"}`;
    const tbody = $("#cpTable tbody"), empty = $("#cpEmpty");
    empty.hidden = rows.length !== 0;
    tbody.innerHTML = rows.map(x => {
      const overdue = x.stage !== "Completed" && x.dueDate && x.dueDate < cpToday();
      const next = CP_STAGE_NEXT[x.stage];
      return `<tr>
        <td><span class="cp-id">${escapeHtml(x.id)}</span></td>
        <td><b>${escapeHtml(x.clientName || "—")}</b><br><small>${escapeHtml(x.clientMobile || "")}</small></td>
        <td><button class="link-btn cp-content-link" data-cp-action="detail" data-id="${escapeHtml(x.id)}"><b>${escapeHtml(x.contentTitle)}</b></button><br><small>${escapeHtml(x.shootCategory || "")}</small></td>
        <td>${escapeHtml(x.type)}<br><small>${escapeHtml(x.platform)}</small></td>
        <td><span class="cp-stage ${cpStageClass(x.stage)}">${escapeHtml(x.stage)}</span></td>
        <td>${fmtDate(x.shootPlannedDate)}</td>
        <td class="${overdue ? "cp-overdue" : ""}">${fmtDate(x.dueDate)}</td>
        <td>${escapeHtml(x.editor || "Unassigned")}</td>
        <td><span class="cp-priority ${cpPriorityClass(x.priority)}">${escapeHtml(x.priority || "Normal")}</span></td>
        <td><div class="cp-actions">
          ${next ? `<button class="icon-btn-sm" title="Move to ${escapeHtml(next)}" data-cp-action="next" data-id="${escapeHtml(x.id)}"><i class="fa-solid fa-arrow-right"></i></button>` : ""}
          <button class="icon-btn-sm" title="Edit" data-cp-action="edit" data-id="${escapeHtml(x.id)}"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn-sm" title="Duplicate" data-cp-action="duplicate" data-id="${escapeHtml(x.id)}"><i class="fa-regular fa-copy"></i></button>
          <button class="icon-btn-sm danger" title="Delete" data-cp-action="delete" data-id="${escapeHtml(x.id)}"><i class="fa-solid fa-trash"></i></button>
        </div></td>
      </tr>`;
    }).join("");
  }
  async function loadContentProduction() {
    try { cpItems = await Api.getContentProduction(); state.contentProduction = cpItems; cpLoaded = true; renderContentProductionView(); }
    catch (err) { showToast("Content Production load na thayu: " + err.message, "error"); }
  }
  function openCpModal(item = null) {
    cpEditingId = item?.id || null;
    $("#cpModalTitle").textContent = item ? "Edit Content Production" : "Add Content Production";
    $("#cpId").value = item?.id || "";
    $("#cpClientName").value = item?.clientName || "";
    $("#cpClientMobile").value = item?.clientMobile || "";
    $("#cpContentTitle").value = item?.contentTitle || "";
    $("#cpType").value = item?.type || "Reel";
    $("#cpPlatform").value = item?.platform || "Instagram";
    $("#cpShootCategory").value = item?.shootCategory || "Informative Reel";
    $("#cpPriority").value = item?.priority || "Normal";
    $("#cpShootDate").value = item?.shootPlannedDate || cpToday();
    $("#cpShootBy").value = item?.shootBy || "Dasev";
    $("#cpEditor").value = item?.editor || "";
    $("#cpDueDate").value = item?.dueDate || cpToday(7);
    $("#cpAspect").value = item?.aspectRatio || "9:16";
    $("#cpFinalLink").value = item?.driveLinks?.finalDeliverable || "";
    $("#cpNotes").value = item?.notes || "";
    $("#cpModalOverlay").hidden = false;
  }
  function closeCpModal() { $("#cpModalOverlay").hidden = true; cpEditingId = null; }
  function cpDetailHtml(item) {
    const revs = item.revisionHistory || [];
    const next = CP_STAGE_NEXT[item.stage];
    return `<div class="cp-detail-grid">
      <div><span class="cp-detail-label">Client</span><b>${escapeHtml(item.clientName)}</b><small>${escapeHtml(item.clientMobile || "")}</small></div>
      <div><span class="cp-detail-label">Stage</span><span class="cp-stage ${cpStageClass(item.stage)}">${escapeHtml(item.stage)}</span></div>
      <div><span class="cp-detail-label">Shoot</span><b>${fmtDate(item.shootPlannedDate)}</b><small>By ${escapeHtml(item.shootBy || "—")}</small></div>
      <div><span class="cp-detail-label">Due</span><b>${fmtDate(item.dueDate)}</b><small>${escapeHtml(item.editor || "Unassigned")}</small></div>
    </div>
    <div class="cp-detail-section"><h3>Workflow</h3><div class="cp-workflow">${CP_STAGES.map((st,i)=>`<span class="${st===item.stage?"active":""} ${CP_STAGES.indexOf(item.stage)>i?"done":""}">${i+1}. ${escapeHtml(st)}</span>`).join("<i class='fa-solid fa-chevron-right'></i>")}</div></div>
    <div class="cp-detail-section"><h3>Content Details</h3><div class="cp-detail-meta"><span><b>Type</b>${escapeHtml(item.type)}</span><span><b>Platform</b>${escapeHtml(item.platform)}</span><span><b>Category</b>${escapeHtml(item.shootCategory || "—")}</span><span><b>Priority</b>${escapeHtml(item.priority || "Normal")}</span><span><b>Aspect</b>${escapeHtml(item.aspectRatio || "—")}</span><span><b>Editor</b>${escapeHtml(item.editor || "Unassigned")}</span></div><p class="cp-detail-notes">${escapeHtml(item.notes || "No notes")}</p>${item.driveLinks?.finalDeliverable ? `<a href="${escapeHtml(item.driveLinks.finalDeliverable)}" target="_blank" rel="noopener" class="btn btn-ghost btn-sm">Open Final Deliverable</a>` : ""}</div>
    <div class="cp-detail-section"><div class="cp-section-head"><h3>Revision History (${revs.length})</h3></div><div class="cp-revision-form"><input id="cpRevBy" placeholder="Requested by" value="Client"/><input id="cpRevFeedback" placeholder="Revision feedback"/><button class="btn btn-primary btn-sm" data-cp-detail="add-revision" data-id="${escapeHtml(item.id)}">Add Revision</button></div><div class="cp-revisions">${revs.length ? revs.map(r=>`<div class="cp-revision"><div><b>#${r.revisionNumber} · ${escapeHtml(r.requestedBy)}</b><small>${fmtDate(r.requestedAt)} · ${escapeHtml(r.status)}</small></div><p>${escapeHtml(r.feedback)}</p>${r.status !== "Resolved" ? `<button class="btn btn-ghost btn-sm" data-cp-detail="resolve-revision" data-id="${escapeHtml(item.id)}" data-rev="${escapeHtml(r.id)}">Resolve</button>` : ""}</div>`).join("") : `<p class="muted">No revisions recorded.</p>`}</div></div>
    <div class="modal-footer"><button class="btn btn-ghost" data-cp-detail="edit" data-id="${escapeHtml(item.id)}">Edit</button>${next ? `<button class="btn btn-primary" data-cp-detail="next" data-id="${escapeHtml(item.id)}"><i class="fa-solid fa-arrow-right"></i> ${escapeHtml(next)}</button>` : `<span class="cp-done-label"><i class="fa-solid fa-circle-check"></i> Completed</span>`}</div>`;
  }
  async function openCpDetail(id) { try { const item = await Api.getContentProductionItem(id); $("#cpDetailTitle").textContent = `${item.id} · ${item.contentTitle}`; $("#cpDetailBody").innerHTML = cpDetailHtml(item); $("#cpDetailOverlay").hidden = false; } catch(err) { showToast(err.message,"error"); } }
  function closeCpDetail() { $("#cpDetailOverlay").hidden = true; }
  function initContentProduction() {
    if (!$("#view-content-production")) return;
    $("#cpAddBtn").onclick = () => openCpModal();
    $("#cpEmptyAdd").onclick = () => openCpModal();
    $("#cpRefreshBtn").onclick = loadContentProduction;
    ["#cpSearch","#cpStageFilter","#cpTypeFilter","#cpPlatformFilter","#cpPriorityFilter"].forEach(sel => $(sel).addEventListener("input", renderContentProductionView));
    $("#cpModalClose").onclick = closeCpModal; $("#cpCancel").onclick = closeCpModal;
    $("#cpForm").addEventListener("submit", async e => { e.preventDefault(); const payload={clientName:$("#cpClientName").value.trim(),clientMobile:$("#cpClientMobile").value.trim(),contentTitle:$("#cpContentTitle").value.trim(),type:$("#cpType").value,platform:$("#cpPlatform").value,shootCategory:$("#cpShootCategory").value,priority:$("#cpPriority").value,shootPlannedDate:$("#cpShootDate").value,shootBy:$("#cpShootBy").value.trim(),editor:$("#cpEditor").value.trim(),dueDate:$("#cpDueDate").value,aspectRatio:$("#cpAspect").value,finalDeliverableLink:$("#cpFinalLink").value.trim(),notes:$("#cpNotes").value.trim()}; try { if(cpEditingId){ await Api.updateContentProduction(cpEditingId,payload); showToast("Content updated","success"); } else { await Api.createContentProduction(payload); showToast("Content added to Shoot Planned","success"); } closeCpModal(); await loadContentProduction(); } catch(err){ showToast(err.message,"error"); } });
    $("#cpTable").addEventListener("click", async e => { const b=e.target.closest("[data-cp-action]"); if(!b)return; const id=b.dataset.id, action=b.dataset.cpAction; try { if(action==="detail") return openCpDetail(id); const item=cpItems.find(x=>x.id===id); if(!item)return; if(action==="edit") return openCpModal(item); if(action==="duplicate"){ await Api.duplicateContentProduction(id); showToast("Content duplicated","success"); await loadContentProduction(); } else if(action==="delete"){ openConfirm("Delete Content", `Delete ${item.contentTitle}?`, async()=>{ try{await Api.deleteContentProduction(id); showToast("Content deleted","success"); await loadContentProduction();}catch(err){showToast(err.message,"error");} }); } else if(action==="next"){ const next=CP_STAGE_NEXT[item.stage]; if(!next)return; const meta=next==="Assigned to Editor"?{editor:item.editor||prompt("Editor name:")||"Unassigned"}:next==="Upload"?{uploadedBy:state.me?.name}: {completedBy:state.me?.name}; await Api.updateContentProductionStage(id,next,meta); showToast(`Moved to ${next}`,"success"); await loadContentProduction(); } } catch(err){ showToast(err.message,"error"); } });
    $("#cpDetailClose").onclick=closeCpDetail;
    $("#cpDetailBody").addEventListener("click", async e => { const b=e.target.closest("[data-cp-detail]"); if(!b)return; const id=b.dataset.id; const action=b.dataset.cpDetail; try { if(action==="edit"){ const item=await Api.getContentProductionItem(id); closeCpDetail(); openCpModal(item); } else if(action==="next"){ const item=await Api.getContentProductionItem(id); const next=CP_STAGE_NEXT[item.stage]; if(next){ await Api.updateContentProductionStage(id,next,next==="Upload"?{uploadedBy:state.me?.name}:next==="Completed"?{completedBy:state.me?.name}:{editor:item.editor||"Unassigned"}); showToast(`Moved to ${next}`,"success"); await openCpDetail(id); await loadContentProduction(); } } else if(action==="add-revision"){ const by=$("#cpRevBy").value.trim()||"Client", feedback=$("#cpRevFeedback").value.trim(); if(!feedback)return showToast("Revision feedback lakho","error"); await Api.addProductionRevision(id,{requestedBy:by,feedback}); showToast("Revision recorded","success"); await openCpDetail(id); await loadContentProduction(); } else if(action==="resolve-revision"){ await Api.updateProductionRevision(id,b.dataset.rev,{status:"Resolved"}); showToast("Revision resolved","success"); await openCpDetail(id); } } catch(err){showToast(err.message,"error");} });
  }

  /* ---- Roles: what this logged-in user may see ---- */
  const ROLE_LABEL = { owner: "Owner", manager: "Manager", sales: "Sales", finance: "Finance", editor: "Editor", designer: "Designer", shooter: "Shooter", sm: "Social media", viewer: "Viewer" };
  const TEAM_ROLES = ["manager", "sales", "finance", "editor", "designer", "shooter", "sm", "viewer"];
  const VIEW_MODULE = { dashboard: "dashboard", calendar: "calendar", clients: "clients", leads: "leads", payments: "payments", expenses: "expenses", reports: "reports", categories: "payments", export: "reports", backup: "backup", settings: "settings", packages: "clients", "content-production": "contentProduction" };
  const can = (m) => !!(state.me && state.me.access && state.me.access[m]);
  const viewAllowed = (v) => !VIEW_MODULE[v] || can(VIEW_MODULE[v]);
  const firstAllowedView = () => ["dashboard", "calendar", "clients", "leads", "payments", "expenses", "reports"].find(viewAllowed) || "calendar";

  function applyRoleToUI() {
    const me = state.me;
    document.body.classList.toggle("no-money", !can("payments"));
    $$(".nav-item[data-view]").forEach((n) => { n.style.display = viewAllowed(n.dataset.view) ? "" : "none"; });
    $$(".nav-item[data-goto]").forEach((n) => { n.style.display = can("clients") ? "" : "none"; });
    $$(".nav-parent[data-toggle]").forEach((n) => {
      const sub = document.getElementById(n.dataset.toggle);
      const anyShown = sub && [...sub.querySelectorAll(".nav-item")].some((x) => x.style.display !== "none" && !x.classList.contains("nav-soon"));
      n.style.display = anyShown ? "" : "none";
      if (sub && !anyShown) sub.style.display = "none";
    });
    const nav = $(".sidebar-nav");
    if (nav) {
      let label = null, shown = false;
      const flush = () => { if (label) label.style.display = shown ? "" : "none"; };
      [...nav.children].forEach((el) => {
        if (el.classList.contains("nav-group-label")) { flush(); label = el; shown = false; }
        else if (el.style.display !== "none" && !el.classList.contains("nav-soon")) shown = true;
      });
      flush();
    }
    const nm = $("#sidebarAgencyName"); if (nm) nm.textContent = me.name;
    const rl = $(".user-meta span"); if (rl) rl.textContent = ROLE_LABEL[me.role] || me.role;
    const pn = $(".profile-name"); if (pn) pn.textContent = me.name;
  }

  async function loadInitialData() {
    state.me = await Api.getMe();
    // Load only what this role may read, so one 403 can't break the whole app.
    const part = (ok, fn, empty) => (ok ? fn().catch(() => empty) : Promise.resolve(empty));
    const [payments, categories, settings, expenses, expenseCategories, leads, platformOptions, contentProduction, clientProfiles] = await Promise.all([
      part(can("payments"), Api.getPayments, []),
      part(true, Api.getCategories, []),
      part(true, Api.getSettings, {}),
      part(can("expenses"), Api.getExpenses, []),
      part(true, Api.getExpenseCategories, []),
      part(can("leads"), Api.getLeads, []),
      part(true, Api.getPlatformOptions, []),
      part(can("contentProduction"), Api.getContentProduction, []),
      part(can("clients"), Api.getClientProfiles, {})
    ]);
    state.payments = payments;
    state.categories = categories;
    state.settings = { ...state.settings, ...settings };
    state.expenses = expenses;
    state.expenseCategories = expenseCategories;
    state.leads = leads;
    state.platformOptions = platformOptions;
    state.contentProduction = contentProduction;
    state.clientProfiles = clientProfiles;

    applySettingsToUI();
    applyRoleToUI();
    renderGreeting();
    populateCategorySelects();

    if (can("dashboard")) await loadDashboard();
    let { view, arg } = parseHash();
    if (!document.getElementById("view-" + view) || !viewAllowed(view)) { view = firstAllowedView(); arg = ""; }
    setActiveView(view, arg);
  }

  /* ---- Team management (Owner only, inside Settings) ---- */
  async function renderTeamCard() {
    if (!can("team")) return;
    let card = $("#teamCard");
    if (!card) {
      card = document.createElement("div");
      card.id = "teamCard";
      card.className = "card";
      card.style.margin = "16px 0";
      card.style.padding = "20px";
      $("#view-settings").appendChild(card);
    }
    let users = [];
    try { users = await Api.getUsers(); } catch (err) { card.innerHTML = `<h3>Team</h3><p>Load na thayu: ${escapeHtml(err.message)}</p>`; return; }
    const opts = (sel) => TEAM_ROLES.map((r) => `<option value="${r}" ${r === sel ? "selected" : ""}>${ROLE_LABEL[r]}</option>`).join("");
    const rows = users.map((u) => {
      const locked = u.role === "owner" || u.id === state.me.id;
      return `<tr data-uid="${u.id}">
        <td><b>${escapeHtml(u.name)}</b><br><small style="color:var(--text-muted)">${escapeHtml(u.email)}</small></td>
        <td>${locked ? escapeHtml(ROLE_LABEL[u.role] || u.role) : `<select class="team-role">${opts(u.role)}</select>`}</td>
        <td>${u.active ? "Active" : "<span style='color:var(--danger)'>Disabled</span>"}${u.must_change_password ? "<br><small>Navo password baki</small>" : ""}</td>
        <td>${locked ? "" : `<button class="btn btn-ghost btn-sm team-toggle">${u.active ? "Disable" : "Enable"}</button> <button class="btn btn-ghost btn-sm team-reset">Reset password</button>`}</td>
      </tr>`;
    }).join("");
    card.innerHTML = `
      <h3 style="margin:0 0 4px">Team</h3>
      <p style="margin:0 0 12px;color:var(--text-muted)">Darek member nu potanu login. Role pramane access male che. <a href="/activity" target="_blank">Activity log jovo</a></p>
      <div id="teamNotice"></div>
      <table class="data-table" style="width:100%;margin-bottom:16px"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
        <input id="tmName" placeholder="Naam" style="flex:1;min-width:140px" />
        <input id="tmEmail" type="email" placeholder="Email" style="flex:1;min-width:180px" />
        <select id="tmRole">${opts("sales")}</select>
        <button class="btn btn-primary" id="tmAdd"><i class="fa-solid fa-plus"></i> Add member</button>
      </div>`;
    const notice = (title, pw) => {
      $("#teamNotice").innerHTML = `<div style="background:var(--warning-bg);border-radius:10px;padding:12px 14px;margin-bottom:12px">
        <b>${escapeHtml(title)}</b><br>Temporary password: <code style="font-size:15px;user-select:all">${escapeHtml(pw)}</code><br>
        <small>Aa fakt ek j vaar dekhase. Member ne aapo; pehli vaar login karse tyare e navo password set karse.</small></div>`;
    };
    $("#tmAdd").onclick = async () => {
      try {
        const r = await Api.createUser({ name: $("#tmName").value, email: $("#tmEmail").value, role: $("#tmRole").value });
        await renderTeamCard();
        notice(`${r.user.name} add thayo`, r.tempPassword);
      } catch (err) { showToast(err.message, "error"); }
    };
    card.onchange = async (e) => {
      const sel = e.target.closest(".team-role"); if (!sel) return;
      try { await Api.updateUser(sel.closest("tr").dataset.uid, { role: sel.value }); showToast("Role badlayo", "success"); }
      catch (err) { showToast(err.message, "error"); await renderTeamCard(); }
    };
    card.onclick = async (e) => {
      const tr = e.target.closest("tr[data-uid]"); if (!tr) return;
      const uid = tr.dataset.uid, u = users.find((x) => String(x.id) === uid);
      if (e.target.closest(".team-toggle")) {
        try { await Api.updateUser(uid, { active: !u.active }); await renderTeamCard(); } catch (err) { showToast(err.message, "error"); }
      } else if (e.target.closest(".team-reset")) {
        openConfirm("Password reset karvo?", `${u.name} ne navo temporary password male, ane e badha device par logout thase.`, async () => {
          try { const r = await Api.resetUserPassword(uid); await renderTeamCard(); notice(`${u.name} no password reset thayo`, r.tempPassword); }
          catch (err) { showToast(err.message, "error"); }
        });
      }
    };
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  document.addEventListener("DOMContentLoaded", async () => {
    initNavigation();
    initContentProduction();
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
    initCalendar();
    initPdfReports();
    initSettingsView();
    initGlobalSearch();
    initProfileAndLogout();
    initDashboardFilter();
    initOneTimeJobModal();
    initPackageTypePicker();
    initPostReelPackageModal();
    initManagementPackageModal();
    initAddTypePicker();
    initClientPickerModal();
    initPackagesModule();

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

/* ====================================================================== */
/* Custom dropdowns: every <select> gets a styled, searchable popup.      */
/* The real <select> stays in the DOM (hidden), so all existing code that */
/* reads/sets .value, .options or listens to "change" keeps working.      */
/* Opt out with data-native on a <select>.                                */
/* ====================================================================== */
(function () {
  "use strict";
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const indexDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  let open = null; // { sel, btn, pop, items, hl }

  const labelOf = (sel) => {
    const o = sel.options[sel.selectedIndex];
    return o ? o.textContent.trim() : "";
  };

  function closeList() {
    if (!open) return;
    open.pop.remove();
    open.btn.classList.remove("open");
    open.btn.setAttribute("aria-expanded", "false");
    open = null;
  }

  function choose(sel, btn, index) {
    const opt = sel.options[index];
    if (!opt || opt.disabled) return;
    const changed = sel.selectedIndex !== index;
    sel.selectedIndex = index; // our override refreshes the label
    closeList();
    btn.focus();
    if (changed) {
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function highlight(i, scroll) {
    if (!open) return;
    open.items.forEach((it, n) => it.el.classList.toggle("hl", n === i));
    open.hl = i;
    if (scroll && open.items[i]) open.items[i].el.scrollIntoView({ block: "nearest" });
  }

  function visibleItems() {
    return open.items.map((it, n) => ({ it, n })).filter((x) => !x.it.el.hidden && !x.it.disabled);
  }

  function openList(sel, btn) {
    closeList();
    if (!sel.isConnected || sel.disabled) return;
    const pop = document.createElement("div");
    pop.className = "cs-pop";
    pop.setAttribute("role", "listbox");
    const list = document.createElement("div");
    list.className = "cs-list";
    const items = [];
    const addOption = (opt, index) => {
      const el = document.createElement("div");
      el.className = "cs-opt" + (index === sel.selectedIndex ? " sel" : "") + (opt.disabled ? " dis" : "");
      el.textContent = opt.textContent.trim() || "\u00A0";
      el.setAttribute("role", "option");
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("click", () => choose(sel, btn, index));
      list.appendChild(el);
      items.push({ el, index, disabled: opt.disabled, text: el.textContent.toLowerCase() });
    };
    let idx = 0;
    [...sel.children].forEach((child) => {
      if (child.tagName === "OPTGROUP") {
        const g = document.createElement("div");
        g.className = "cs-group";
        g.textContent = child.label;
        list.appendChild(g);
        [...child.children].forEach((o) => addOption(o, idx++));
      } else if (child.tagName === "OPTION") addOption(child, idx++);
    });
    let search = null;
    if (items.length >= 8) {
      search = document.createElement("input");
      search.type = "text";
      search.className = "cs-search";
      search.placeholder = "Search…";
      search.autocomplete = "off";
      search.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        items.forEach((it) => { it.el.hidden = !!q && !it.text.includes(q); });
        const first = visibleItems()[0];
        highlight(first ? first.n : -1, true);
      });
      pop.appendChild(search);
    }
    pop.appendChild(list);
    document.body.appendChild(pop);
    btn.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    open = { sel, btn, pop, items, hl: -1 };

    // position (fixed, flips upward when there is no room below)
    const r = btn.getBoundingClientRect();
    pop.style.minWidth = Math.max(r.width, 160) + "px";
    pop.style.maxHeight = Math.min(320, Math.floor(window.innerHeight * 0.55)) + "px";
    const ph = pop.offsetHeight;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8 && r.top > ph + 14) top = r.top - ph - 6;
    let left = r.left;
    if (left + pop.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pop.offsetWidth - 8);
    pop.style.top = Math.max(8, top) + "px";
    pop.style.left = left + "px";

    const cur = items.findIndex((it) => it.index === sel.selectedIndex);
    highlight(cur, true);
    if (search) search.focus();
  }

  function enhance(sel) {
    if (sel.dataset.cs || sel.multiple || sel.size > 1 || sel.hasAttribute("data-native")) return;
    sel.dataset.cs = "1";

    const wrap = document.createElement("span");
    wrap.className = "cs-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    const label = document.createElement("span");
    label.className = "cs-label";
    const caret = document.createElement("span");
    caret.className = "cs-caret";
    caret.innerHTML = '<svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    btn.append(label, caret);

    sel.parentNode.insertBefore(wrap, sel);
    wrap.append(btn, sel);
    sel.classList.add("cs-native");
    sel.tabIndex = -1;

    const refresh = () => { label.textContent = labelOf(sel) || "\u00A0"; };
    const syncAttrs = () => {
      const cls = [...sel.classList].filter((c) => c !== "cs-native").join(" ");
      btn.className = "cs-btn " + cls + (open && open.btn === btn ? " open" : "") + (btn.classList.contains("cs-invalid") ? " cs-invalid" : "");
      btn.disabled = sel.disabled;
      btn.title = sel.title || "";
      btn.style.display = sel.hidden || sel.style.display === "none" ? "none" : "";
    };

    // keep working when code sets sel.value / sel.selectedIndex directly
    Object.defineProperty(sel, "value", {
      configurable: true,
      get() { return valueDesc.get.call(sel); },
      set(v) { valueDesc.set.call(sel, v); refresh(); }
    });
    Object.defineProperty(sel, "selectedIndex", {
      configurable: true,
      get() { return indexDesc.get.call(sel); },
      set(v) { indexDesc.set.call(sel, v); refresh(); }
    });

    new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["selected", "label", "value"] });
    new MutationObserver(syncAttrs).observe(sel, { attributes: true, attributeFilter: ["class", "disabled", "hidden", "style", "title"] });
    sel.addEventListener("change", () => { btn.classList.remove("cs-invalid"); refresh(); });
    sel.addEventListener("invalid", () => { btn.classList.add("cs-invalid"); btn.focus(); });
    if (sel.form) sel.form.addEventListener("reset", () => setTimeout(refresh, 0));

    btn.addEventListener("click", () => { open && open.btn === btn ? closeList() : openList(sel, btn); });
    btn.addEventListener("keydown", (e) => {
      if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(sel, btn); }
    });

    refresh();
    syncAttrs();
  }

  // keyboard control while the list is open
  document.addEventListener("keydown", (e) => {
    if (!open) return;
    const vis = visibleItems();
    const pos = vis.findIndex((x) => x.n === open.hl);
    if (e.key === "Escape") { e.preventDefault(); const b = open.btn; closeList(); b.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); const nx = vis[Math.min(pos + 1, vis.length - 1)]; if (nx) highlight(nx.n, true); }
    else if (e.key === "ArrowUp") { e.preventDefault(); const pv = vis[Math.max(pos - 1, 0)]; if (pv) highlight(pv.n, true); }
    else if (e.key === "Enter") { e.preventDefault(); const it = open.items[open.hl]; if (it) choose(open.sel, open.btn, it.index); }
    else if (e.key === "Tab") closeList();
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (open && !open.pop.contains(e.target) && !open.btn.contains(e.target)) closeList();
  }, true);
  window.addEventListener("scroll", (e) => { if (open && !open.pop.contains(e.target)) closeList(); }, true);
  window.addEventListener("resize", closeList);

  const scan = (root) => {
    if (root.matches && root.matches("select")) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll("select").forEach(enhance);
  };
  const start = () => {
    scan(document);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); })))
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

/* ====================================================================== */
/* Custom date picker: every <input type="date"> gets a styled calendar.  */
/* The real input stays in the DOM (hidden): .value is still YYYY-MM-DD,  */
/* and "input"/"change" events still fire. Opt out with data-native.      */
/* ====================================================================== */
(function () {
  "use strict";
  const valueDesc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const SHORT = MONTHS.map((m) => m.slice(0, 3));
  const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? { y: +m[1], m: +m[2] - 1, d: +m[3] } : null;
  };
  const fmt = (s) => { const p = parse(s); return p ? `${pad(p.d)} ${SHORT[p.m]} ${p.y}` : ""; };
  const todayIso = () => { const t = new Date(); return iso(t.getFullYear(), t.getMonth(), t.getDate()); };
  const CAL_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';

  let cur = null; // { inp, btn, pop, view, y, m }

  function closePicker() {
    if (!cur) return;
    cur.pop.remove();
    cur.btn.classList.remove("open");
    cur = null;
  }

  function inRange(inp, s) {
    if (inp.min && s < inp.min) return false;
    if (inp.max && s > inp.max) return false;
    return true;
  }

  function choose(s) {
    const { inp, btn } = cur;
    const changed = inp.value !== s;
    inp.value = s; // our override refreshes the label
    closePicker();
    btn.focus();
    if (changed) {
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  function render() {
    const { inp, pop, view, y, m } = cur;
    const sel = inp.value;
    const today = todayIso();
    let html = "";
    if (view === "days") {
      html += `<div class="dp-head">
        <button type="button" class="dp-nav" data-dp="prev" aria-label="Previous month">‹</button>
        <button type="button" class="dp-title" data-dp="months">${MONTHS[m]} ${y} <span>▾</span></button>
        <button type="button" class="dp-nav" data-dp="next" aria-label="Next month">›</button></div>`;
      html += `<div class="dp-week">${WEEK.map((w) => `<span>${w}</span>`).join("")}</div><div class="dp-grid">`;
      const lead = (new Date(y, m, 1).getDay() + 6) % 7;
      const start = new Date(y, m, 1 - lead);
      for (let i = 0; i < 42; i++) {
        const dt = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
        const s = iso(dt.getFullYear(), dt.getMonth(), dt.getDate());
        const cls = ["dp-day"];
        if (dt.getMonth() !== m) cls.push("out");
        if (s === sel) cls.push("sel");
        if (s === today) cls.push("today");
        const ok = inRange(inp, s);
        if (!ok) cls.push("dis");
        html += `<button type="button" class="${cls.join(" ")}" data-dp-day="${s}" ${ok ? "" : "disabled"}>${dt.getDate()}</button>`;
      }
      html += "</div>";
    } else {
      html += `<div class="dp-head">
        <button type="button" class="dp-nav" data-dp="prev-year" aria-label="Previous year">‹</button>
        <span class="dp-title static">${y}</span>
        <button type="button" class="dp-nav" data-dp="next-year" aria-label="Next year">›</button></div><div class="dp-months">`;
      const sp = parse(sel);
      html += MONTHS.map((n, i) => `<button type="button" class="dp-mon ${sp && sp.y === y && sp.m === i ? "sel" : ""}" data-dp-month="${i}">${SHORT[i]}</button>`).join("");
      html += "</div>";
    }
    html += `<div class="dp-foot">${inp.required ? "<span></span>" : `<button type="button" class="dp-link" data-dp="clear">Clear</button>`}
      <button type="button" class="dp-link" data-dp="today" ${inRange(inp, today) ? "" : "disabled"}>Today</button></div>`;
    pop.innerHTML = html;
  }

  function openPicker(inp, btn) {
    closePicker();
    if (!inp.isConnected || inp.disabled) return;
    const p = parse(inp.value) || parse(todayIso());
    const pop = document.createElement("div");
    pop.className = "dp-pop";
    pop.addEventListener("mousedown", (e) => e.preventDefault());
    pop.addEventListener("click", (e) => {
      const day = e.target.closest("[data-dp-day]");
      if (day) { choose(day.dataset.dpDay); return; }
      const mon = e.target.closest("[data-dp-month]");
      if (mon) { cur.m = +mon.dataset.dpMonth; cur.view = "days"; render(); return; }
      const a = e.target.closest("[data-dp]");
      if (!a) return;
      const act = a.dataset.dp;
      if (act === "prev") { cur.m--; if (cur.m < 0) { cur.m = 11; cur.y--; } render(); }
      else if (act === "next") { cur.m++; if (cur.m > 11) { cur.m = 0; cur.y++; } render(); }
      else if (act === "prev-year") { cur.y--; render(); }
      else if (act === "next-year") { cur.y++; render(); }
      else if (act === "months") { cur.view = "months"; render(); }
      else if (act === "today") choose(todayIso());
      else if (act === "clear") choose("");
    });
    document.body.appendChild(pop);
    btn.classList.add("open");
    cur = { inp, btn, pop, view: "days", y: p.y, m: p.m };
    render();

    const r = btn.getBoundingClientRect();
    const ph = pop.offsetHeight;
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8 && r.top > ph + 14) top = r.top - ph - 6;
    let left = r.left;
    if (left + pop.offsetWidth > window.innerWidth - 8) left = Math.max(8, window.innerWidth - pop.offsetWidth - 8);
    pop.style.top = Math.max(8, top) + "px";
    pop.style.left = left + "px";
  }

  function enhance(inp) {
    if (inp.dataset.dp || inp.type !== "date" || inp.hasAttribute("data-native")) return;
    inp.dataset.dp = "1";
    const wrap = document.createElement("span");
    wrap.className = "cs-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("aria-haspopup", "dialog");
    const label = document.createElement("span");
    label.className = "cs-label";
    const icon = document.createElement("span");
    icon.className = "cs-caret dp-icon";
    icon.innerHTML = CAL_ICON;
    btn.append(label, icon);

    inp.parentNode.insertBefore(wrap, inp);
    wrap.append(btn, inp);
    inp.classList.add("cs-native");
    inp.tabIndex = -1;

    const refresh = () => {
      const t = fmt(inp.value);
      label.textContent = t || inp.getAttribute("placeholder") || "Select date";
      label.classList.toggle("dp-empty", !t);
    };
    const syncAttrs = () => {
      const cls = [...inp.classList].filter((c) => c !== "cs-native").join(" ");
      btn.className = "cs-btn dp-btn " + cls + (cur && cur.btn === btn ? " open" : "") + (btn.classList.contains("cs-invalid") ? " cs-invalid" : "");
      btn.disabled = inp.disabled;
      btn.title = inp.title || "";
      btn.style.display = inp.hidden || inp.style.display === "none" ? "none" : "";
    };
    Object.defineProperty(inp, "value", {
      configurable: true,
      get() { return valueDesc.get.call(inp); },
      set(v) { valueDesc.set.call(inp, v); refresh(); }
    });
    new MutationObserver(syncAttrs).observe(inp, { attributes: true, attributeFilter: ["class", "disabled", "hidden", "style", "title"] });
    inp.addEventListener("change", () => { btn.classList.remove("cs-invalid"); refresh(); });
    inp.addEventListener("invalid", () => { btn.classList.add("cs-invalid"); btn.focus(); });
    if (inp.form) inp.form.addEventListener("reset", () => setTimeout(refresh, 0));
    btn.addEventListener("click", () => { cur && cur.btn === btn ? closePicker() : openPicker(inp, btn); });
    btn.addEventListener("keydown", (e) => {
      if (!cur && ["ArrowDown", "Enter", " "].includes(e.key)) { e.preventDefault(); openPicker(inp, btn); }
    });
    refresh();
    syncAttrs();
  }

  document.addEventListener("keydown", (e) => {
    if (cur && e.key === "Escape") { e.preventDefault(); const b = cur.btn; closePicker(); b.focus(); }
  }, true);
  document.addEventListener("mousedown", (e) => {
    if (cur && !cur.pop.contains(e.target) && !cur.btn.contains(e.target)) closePicker();
  }, true);
  window.addEventListener("scroll", (e) => { if (cur && !cur.pop.contains(e.target)) closePicker(); }, true);
  window.addEventListener("resize", closePicker);

  const scan = (root) => {
    if (root.matches && root.matches('input[type="date"]')) enhance(root);
    if (root.querySelectorAll) root.querySelectorAll('input[type="date"]').forEach(enhance);
  };
  const start = () => {
    scan(document);
    new MutationObserver((muts) => muts.forEach((m) => m.addedNodes.forEach((n) => { if (n.nodeType === 1) scan(n); })))
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();