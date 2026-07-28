/* ============================================================================
   PayFlow — Payment Manager
   Frontend logic (vanilla JS)
   ============================================================================ */

(function () {
  "use strict";

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const state = {
    payments: [],
    clients: [],
    categories: [],
    settings: {},
    dashboard: null,
    editingPaymentId: null,
    charts: {}
  };

  /* ---------------------------------------------------------------------- */
  /* Helpers                                                                */
  /* ---------------------------------------------------------------------- */

  function fmtMoney(n) {
    const cur = (state.settings && state.settings.currency) || "₹";
    const num = Number(n) || 0;
    return `${cur}${num.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  }

  function fmtDate(d) {
    if (!d) return "—";
    const date = new Date(d);
    if (isNaN(date)) return d;
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/);
    return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
      ...options
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const j = await res.json();
        if (j.error) msg = j.error;
      } catch (_) {}
      throw new Error(msg);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return res.json();
    return res;
  }

  function toast(type, title, message) {
    const container = $("#toastContainer");
    if (!container) return;
    const icon = type === "success" ? "fa-circle-check" : type === "error" ? "fa-circle-xmark" : "fa-circle-info";
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.innerHTML = `
      <div class="toast-icon"><i class="fa-solid ${icon}"></i></div>
      <div class="toast-text"><b>${escapeHtml(title)}</b>${message ? `<span>${escapeHtml(message)}</span>` : ""}</div>
    `;
    container.appendChild(el);
    setTimeout(() => {
      el.classList.add("leaving");
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }

  let confirmCallback = null;
  function askConfirm(title, message, okLabel = "Delete") {
    return new Promise((resolve) => {
      $("#confirmTitle").textContent = title;
      $("#confirmMessage").textContent = message;
      $("#confirmOkBtn").textContent = okLabel;
      $("#confirmOverlay").hidden = false;
      confirmCallback = resolve;
    });
  }
  $("#confirmCancelBtn")?.addEventListener("click", () => {
    $("#confirmOverlay").hidden = true;
    if (confirmCallback) confirmCallback(false);
    confirmCallback = null;
  });
  $("#confirmOkBtn")?.addEventListener("click", () => {
    $("#confirmOverlay").hidden = true;
    if (confirmCallback) confirmCallback(true);
    confirmCallback = null;
  });

  /* ---------------------------------------------------------------------- */
  /* Sidebar / navigation                                                  */
  /* ---------------------------------------------------------------------- */

  function openMobileSidebar() {
    $("#sidebar")?.classList.add("open");
    $("#sidebarOverlay")?.classList.add("show");
  }
  function closeMobileSidebar() {
    $("#sidebar")?.classList.remove("open");
    $("#sidebarOverlay")?.classList.remove("show");
  }
  $("#burgerBtn")?.addEventListener("click", openMobileSidebar);
  $("#sidebarClose")?.addEventListener("click", closeMobileSidebar);
  $("#sidebarOverlay")?.addEventListener("click", closeMobileSidebar);

  function switchView(view) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $(`#view-${view}`)?.classList.add("active");
    $$(".nav-item[data-view]").forEach((n) => n.classList.toggle("active", n.dataset.view === view));
    closeMobileSidebar();
    if (view === "clients") renderClients();
    if (view === "reports") { runReport(); loadTopClients(); }
    if (view === "categories") renderCategories();
    if (view === "export") populateInvoiceSelect();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $$("[data-view]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      switchView(el.dataset.view);
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Dark mode / theme                                                     */
  /* ---------------------------------------------------------------------- */

  function applyTheme(theme) {
    document.body.setAttribute("data-theme", theme || "teal");
    $$(".swatch").forEach((s) => s.classList.toggle("active", s.dataset.theme === theme));
  }

  async function toggleDarkMode(save = true) {
    document.body.classList.toggle("dark-mode");
    const isDark = document.body.classList.contains("dark-mode");
    $("#darkModeToggle") && ($("#darkModeToggle").innerHTML = `<i class="fa-solid fa-${isDark ? "sun" : "moon"}"></i>`);
    $("#lightModeBtn")?.classList.toggle("active", !isDark);
    $("#darkModeBtn")?.classList.toggle("active", isDark);
    if (save) {
      state.settings.darkMode = isDark;
      try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ darkMode: isDark }) }); } catch (_) {}
    }
  }
  $("#darkModeToggle")?.addEventListener("click", () => toggleDarkMode());
  $("#lightModeBtn")?.addEventListener("click", () => {
    if (document.body.classList.contains("dark-mode")) toggleDarkMode();
  });
  $("#darkModeBtn")?.addEventListener("click", () => {
    if (!document.body.classList.contains("dark-mode")) toggleDarkMode();
  });
  $$(".swatch").forEach((s) => {
    s.addEventListener("click", async () => {
      applyTheme(s.dataset.theme);
      state.settings.themeColor = s.dataset.theme;
      try { await api("/api/settings", { method: "PUT", body: JSON.stringify({ themeColor: s.dataset.theme }) }); } catch (_) {}
    });
  });

  function applySettingsToUI() {
    const name = state.settings.companyName || "My Agency";
    $("#sidebarAgencyName") && ($("#sidebarAgencyName").textContent = name);
    document.title = `${name} — PayFlow`;
    $("#settingCompanyName") && ($("#settingCompanyName").value = state.settings.companyName || "");
    $("#settingCurrency") && ($("#settingCurrency").value = state.settings.currency || "₹");
    applyTheme(state.settings.themeColor || "teal");
    if (state.settings.darkMode && !document.body.classList.contains("dark-mode")) toggleDarkMode(false);
  }

  $("#settingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      companyName: $("#settingCompanyName").value.trim() || "My Agency",
      currency: $("#settingCurrency").value.trim() || "₹"
    };
    try {
      state.settings = await api("/api/settings", { method: "PUT", body: JSON.stringify(payload) });
      applySettingsToUI();
      await refreshEverything();
      toast("success", "Settings saved");
    } catch (err) {
      toast("error", "Could not save settings", err.message);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Greeting / date                                                       */
  /* ---------------------------------------------------------------------- */

  function renderGreeting() {
    const h = new Date().getHours();
    const part = h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
    $("#greetingText") && ($("#greetingText").textContent = `Good ${part}, Admin 👋`);
    $("#topbarDate") && ($("#topbarDate").textContent = new Date().toLocaleDateString("en-IN", {
      weekday: "short", day: "2-digit", month: "short", year: "numeric"
    }));
  }

  /* ---------------------------------------------------------------------- */
  /* Notifications (upcoming due payments)                                 */
  /* ---------------------------------------------------------------------- */

  function renderNotifications() {
    const list = $("#notifList");
    const dot = $("#notifDot");
    if (!list) return;
    const due = (state.dashboard?.upcomingDue || []);
    dot && (dot.hidden = due.length === 0);
    list.innerHTML = due.length
      ? due.map((p) => `
        <div class="notif-item">
          <b>${escapeHtml(p.clientName)}</b>
          <span>${fmtMoney(p.pendingAmount)} due ${fmtDate(p.dueDate)}</span>
        </div>
      `).join("")
      : `<div class="notif-item"><span>No upcoming dues 🎉</span></div>`;
  }
  $("#notifBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    $("#notifPanel").hidden = !$("#notifPanel").hidden;
  });
  document.addEventListener("click", (e) => {
    const panel = $("#notifPanel");
    if (panel && !panel.hidden && !panel.contains(e.target) && e.target.id !== "notifBtn") {
      panel.hidden = true;
    }
  });

  $("#logoutBtn")?.addEventListener("click", async () => {
    const ok = await askConfirm("Log out?", "You'll need to reopen PayFlow to sign back in.", "Log out");
    if (ok) toast("info", "Logged out", "See you soon!");
  });

  /* ---------------------------------------------------------------------- */
  /* Global search → jumps to Payments view                                */
  /* ---------------------------------------------------------------------- */

  const globalSearchDebounced = debounce((val) => {
    switchView("payments");
    $("#paymentSearch").value = val;
    renderPayments();
  }, 250);
  $("#globalSearch")?.addEventListener("input", (e) => {
    const v = e.target.value.trim();
    if (v) globalSearchDebounced(v);
  });

  /* ---------------------------------------------------------------------- */
  /* DASHBOARD                                                             */
  /* ---------------------------------------------------------------------- */

  function renderDashboard() {
    const d = state.dashboard;
    if (!d) return;

    $("#statTotalBusiness") && ($("#statTotalBusiness").textContent = fmtMoney(d.totalBusiness));
    $("#statReceived") && ($("#statReceived").textContent = fmtMoney(d.received));
    $("#statPending") && ($("#statPending").textContent = fmtMoney(d.pending));
    $("#statClients") && ($("#statClients").textContent = d.totalClients);
    $("#statMonthlyIncome") && ($("#statMonthlyIncome").textContent = fmtMoney(d.monthlyBusiness));

    $("#todayCollected") && ($("#todayCollected").textContent = fmtMoney(d.todaysCollection));
    $("#todayPending") && ($("#todayPending").textContent = fmtMoney(d.todaysPending));
    $("#progressPercent") && ($("#progressPercent").textContent = `${d.paymentProgress}%`);
    $("#progressFill") && ($("#progressFill").style.width = `${d.paymentProgress}%`);

    const recentBody = $("#recentPaymentsTable tbody");
    if (recentBody) {
      recentBody.innerHTML = d.recentPayments.length
        ? d.recentPayments.map((p) => `
          <tr>
            <td class="cell-name">${escapeHtml(p.clientName)}</td>
            <td><span class="badge-cat">${escapeHtml(p.category)}</span></td>
            <td class="cell-amount">${fmtMoney(p.totalAmount)}</td>
            <td><span class="badge ${p.status}">${p.status}</span></td>
            <td>${fmtDate(p.date)}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="5" style="text-align:center;color:var(--text-faint);padding:20px;">No payments yet</td></tr>`;
    }

    const dueBody = $("#upcomingDueTable tbody");
    if (dueBody) {
      dueBody.innerHTML = d.upcomingDue.length
        ? d.upcomingDue.map((p) => `
          <tr>
            <td class="cell-name">${escapeHtml(p.clientName)}</td>
            <td class="cell-amount">${fmtMoney(p.pendingAmount)}</td>
            <td>${fmtDate(p.dueDate)}</td>
          </tr>
        `).join("")
        : `<tr><td colspan="3" style="text-align:center;color:var(--text-faint);padding:20px;">Nothing due 🎉</td></tr>`;
    }

    renderCharts(d);
    renderNotifications();
  }

  function renderCharts(d) {
    if (typeof Chart === "undefined") return;
    const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim() || undefined;

    Object.values(state.charts).forEach((c) => c?.destroy());
    state.charts = {};

    const pieCtx = $("#statusPieChart");
    if (pieCtx) {
      state.charts.pie = new Chart(pieCtx, {
        type: "doughnut",
        data: {
          labels: ["Paid", "Partial", "Pending"],
          datasets: [{
            data: [d.statusCounts.Paid, d.statusCounts.Partial, d.statusCounts.Pending],
            backgroundColor: ["#1f9d78", "#e8a63b", "#e15b5b"]
          }]
        },
        options: { plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } }, cutout: "65%" }
      });
    }

    const monthCtx = $("#monthlyIncomeChart");
    if (monthCtx) {
      const entries = Object.entries(d.monthlyIncome).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
      state.charts.month = new Chart(monthCtx, {
        type: "line",
        data: {
          labels: entries.map(([k]) => k),
          datasets: [{
            label: "Business",
            data: entries.map(([, v]) => v),
            borderColor: cssVar("--accent") || "#12756c",
            backgroundColor: "rgba(18,117,108,.12)",
            tension: 0.35, fill: true
          }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }

    const catCtx = $("#categoryChart");
    if (catCtx) {
      const entries = Object.entries(d.categoryTotals).sort((a, b) => b[1] - a[1]);
      state.charts.category = new Chart(catCtx, {
        type: "bar",
        data: {
          labels: entries.map(([k]) => k),
          datasets: [{ label: "Business", data: entries.map(([, v]) => v), backgroundColor: cssVar("--accent") || "#12756c", borderRadius: 6 }]
        },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
      });
    }
  }

  $("#quickAddBtn")?.addEventListener("click", () => openPaymentModal());

  /* ---------------------------------------------------------------------- */
  /* PAYMENTS                                                              */
  /* ---------------------------------------------------------------------- */

  function populateCategorySelects() {
    const opts = state.categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    $("#fCategory") && ($("#fCategory").innerHTML = opts);
    $("#filterCategory") && ($("#filterCategory").innerHTML = `<option value="">All Categories</option>${opts}`);
  }

  function getFilteredPayments() {
    const q = ($("#paymentSearch")?.value || "").toLowerCase();
    const cat = $("#filterCategory")?.value || "";
    const status = $("#filterStatus")?.value || "";
    const sort = $("#sortPayments")?.value || "date-desc";

    let list = state.payments.filter((p) => {
      const matchesQ = !q || [p.clientName, p.mobile, p.businessName, p.instagram, p.category, p.status, String(p.totalAmount)]
        .some((f) => String(f || "").toLowerCase().includes(q));
      const matchesCat = !cat || p.category === cat;
      const matchesStatus = !status || p.status === status;
      return matchesQ && matchesCat && matchesStatus;
    });

    switch (sort) {
      case "date-asc": list.sort((a, b) => new Date(a.date) - new Date(b.date)); break;
      case "amount-desc": list.sort((a, b) => b.totalAmount - a.totalAmount); break;
      case "amount-asc": list.sort((a, b) => a.totalAmount - b.totalAmount); break;
      case "name-asc": list.sort((a, b) => a.clientName.localeCompare(b.clientName)); break;
      default: list.sort((a, b) => new Date(b.date) - new Date(a.date));
    }
    return list;
  }

  function renderPayments() {
    const tbody = $("#paymentsTable tbody");
    if (!tbody) return;
    const list = getFilteredPayments();
    $("#paymentsEmpty") && ($("#paymentsEmpty").hidden = list.length > 0);

    tbody.innerHTML = list.map((p) => `
      <tr>
        <td class="cell-name">${escapeHtml(p.clientName)}<div class="cell-sub">${escapeHtml(p.mobile)}</div></td>
        <td>${escapeHtml(p.businessName) || "—"}</td>
        <td><span class="badge-cat">${escapeHtml(p.category)}</span></td>
        <td class="cell-amount">${fmtMoney(p.totalAmount)}</td>
        <td class="cell-amount">${fmtMoney(p.paidAmount)}</td>
        <td class="cell-amount">${fmtMoney(p.pendingAmount)}</td>
        <td><span class="badge ${p.status}">${p.status}</span></td>
        <td>${fmtDate(p.date)}</td>
        <td>
          <div class="row-actions">
            <button data-action="edit" data-id="${p.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button data-action="duplicate" data-id="${p.id}" title="Duplicate"><i class="fa-solid fa-copy"></i></button>
            <button data-action="delete" data-id="${p.id}" class="danger" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  ["paymentSearch"].forEach((id) => $(`#${id}`)?.addEventListener("input", debounce(renderPayments, 200)));
  ["filterCategory", "filterStatus", "sortPayments"].forEach((id) => $(`#${id}`)?.addEventListener("change", renderPayments));

  $("#paymentsTable")?.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    const payment = state.payments.find((p) => p.id === id);
    if (!payment) return;

    if (action === "edit") openPaymentModal(payment);
    if (action === "duplicate") {
      try {
        await api(`/api/payments/${id}/duplicate`, { method: "POST" });
        toast("success", "Payment duplicated");
        await refreshEverything();
      } catch (err) { toast("error", "Could not duplicate", err.message); }
    }
    if (action === "delete") {
      const ok = await askConfirm("Delete this payment?", `${payment.clientName} — ${fmtMoney(payment.totalAmount)} will be permanently removed.`);
      if (ok) {
        try {
          await api(`/api/payments/${id}`, { method: "DELETE" });
          toast("success", "Payment deleted");
          await refreshEverything();
        } catch (err) { toast("error", "Could not delete", err.message); }
      }
    }
  });

  function recalcPending() {
    const total = Number($("#fTotalAmount").value) || 0;
    const paid = Number($("#fPaidAmount").value) || 0;
    const pending = Math.max(total - paid, 0);
    $("#fPendingAmount").value = pending;
    if (paid <= 0) $("#fStatus").value = "Pending";
    else if (paid >= total && total > 0) $("#fStatus").value = "Paid";
    else $("#fStatus").value = "Partial";
  }
  $("#fTotalAmount")?.addEventListener("input", recalcPending);
  $("#fPaidAmount")?.addEventListener("input", recalcPending);

  function openPaymentModal(payment = null) {
    state.editingPaymentId = payment?.id || null;
    $("#paymentModalTitle").textContent = payment ? "Edit Payment" : "Add Payment";
    $("#paymentForm").reset();
    populateCategorySelects();

    $("#paymentId").value = payment?.id || "";
    $("#fClientName").value = payment?.clientName || "";
    $("#fMobile").value = payment?.mobile || "";
    $("#fBusinessName").value = payment?.businessName || "";
    $("#fInstagram").value = payment?.instagram || "";
    $("#fWorkDetails").value = payment?.workDetails || "";
    $("#fCategory").value = payment?.category || state.categories[0] || "";
    $("#fDate").value = payment?.date || new Date().toISOString().slice(0, 10);
    $("#fTotalAmount").value = payment?.totalAmount ?? "";
    $("#fPaidAmount").value = payment?.paidAmount ?? 0;
    $("#fPendingAmount").value = payment?.pendingAmount ?? 0;
    $("#fStatus").value = payment?.status || "Pending";
    $("#fDueDate").value = payment?.dueDate || "";
    $("#fNotes").value = payment?.notes || "";

    $("#paymentModalOverlay").hidden = false;
    setTimeout(() => $("#fClientName").focus(), 60);
  }
  function closePaymentModal() { $("#paymentModalOverlay").hidden = true; }

  $("#addPaymentBtn")?.addEventListener("click", () => openPaymentModal());
  $("#closePaymentModal")?.addEventListener("click", closePaymentModal);
  $("#cancelPaymentBtn")?.addEventListener("click", closePaymentModal);
  $("#paymentModalOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "paymentModalOverlay") closePaymentModal();
  });

  $("#paymentForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
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
    const saveBtn = $("#savePaymentBtn");
    saveBtn.disabled = true;
    try {
      if (state.editingPaymentId) {
        await api(`/api/payments/${state.editingPaymentId}`, { method: "PUT", body: JSON.stringify(payload) });
        toast("success", "Payment updated");
      } else {
        await api("/api/payments", { method: "POST", body: JSON.stringify(payload) });
        toast("success", "Payment added");
      }
      closePaymentModal();
      await refreshEverything();
    } catch (err) {
      toast("error", "Could not save payment", err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  /* ---------------------------------------------------------------------- */
  /* CLIENTS                                                                */
  /* ---------------------------------------------------------------------- */

  function renderClients() {
    const grid = $("#clientGrid");
    if (!grid) return;
    const q = ($("#clientSearch")?.value || "").toLowerCase();
    const list = state.clients.filter((c) => !q || [c.clientName, c.mobile, c.businessName, c.instagram]
      .some((f) => String(f || "").toLowerCase().includes(q)));

    grid.innerHTML = list.length ? list.map((c, idx) => `
      <div class="client-card" data-idx="${idx}">
        <div class="client-card-head">
          <div class="client-avatar">${initials(c.clientName)}</div>
          <div>
            <h4>${escapeHtml(c.clientName)}</h4>
            <span>${escapeHtml(c.businessName || c.mobile || "")}</span>
          </div>
        </div>
        <div class="client-stats">
          <div><span class="cs-label">Business</span><span class="cs-value">${fmtMoney(c.totalBusiness)}</span></div>
          <div><span class="cs-label">Received</span><span class="cs-value">${fmtMoney(c.totalReceived)}</span></div>
          <div><span class="cs-label">Pending</span><span class="cs-value">${fmtMoney(c.totalPending)}</span></div>
        </div>
      </div>
    `).join("") : `<div class="empty-state"><i class="fa-solid fa-address-book"></i><p>No clients yet. Add a payment to create your first client.</p></div>`;

    $$(".client-card", grid).forEach((card) => {
      card.addEventListener("click", () => openClientDrawer(list[Number(card.dataset.idx)]));
    });
  }
  $("#clientSearch")?.addEventListener("input", debounce(renderClients, 200));

  function openClientDrawer(client) {
    $("#clientDrawerTitle").textContent = client.clientName;
    $("#clientDrawerBody").innerHTML = `
      <div class="drawer-head-row">
        <div class="drawer-avatar">${initials(client.clientName)}</div>
        <div>
          <h3>${escapeHtml(client.clientName)}</h3>
          <p class="view-subtitle">${escapeHtml(client.mobile || "")}${client.businessName ? " · " + escapeHtml(client.businessName) : ""}${client.instagram ? " · " + escapeHtml(client.instagram) : ""}</p>
        </div>
      </div>
      <div class="drawer-stats">
        <div class="drawer-stat"><span class="ds-label">Total Business</span><span class="ds-value">${fmtMoney(client.totalBusiness)}</span></div>
        <div class="drawer-stat"><span class="ds-label">Received</span><span class="ds-value">${fmtMoney(client.totalReceived)}</span></div>
        <div class="drawer-stat"><span class="ds-label">Pending</span><span class="ds-value">${fmtMoney(client.totalPending)}</span></div>
      </div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Category</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>
          ${[...client.payments].sort((a, b) => new Date(b.date) - new Date(a.date)).map((p) => `
            <tr>
              <td>${fmtDate(p.date)}</td>
              <td><span class="badge-cat">${escapeHtml(p.category)}</span></td>
              <td class="cell-amount">${fmtMoney(p.totalAmount)}</td>
              <td><span class="badge ${p.status}">${p.status}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
    $("#clientDrawerOverlay").hidden = false;
  }
  $("#closeClientDrawer")?.addEventListener("click", () => { $("#clientDrawerOverlay").hidden = true; });
  $("#clientDrawerOverlay")?.addEventListener("click", (e) => {
    if (e.target.id === "clientDrawerOverlay") $("#clientDrawerOverlay").hidden = true;
  });

  /* ---------------------------------------------------------------------- */
  /* REPORTS                                                                */
  /* ---------------------------------------------------------------------- */

  async function runReport() {
    const type = $("#reportType")?.value || "monthly";
    const status = $("#reportStatus")?.value || "";
    const tbody = $("#reportTable tbody");
    if (!tbody) return;
    try {
      const rows = await api(`/api/reports?type=${encodeURIComponent(type)}&status=${encodeURIComponent(status)}`);
      tbody.innerHTML = rows.length ? rows.map((r) => `
        <tr>
          <td class="cell-name">${escapeHtml(r.key)}</td>
          <td>${r.count}</td>
          <td class="cell-amount">${fmtMoney(r.totalAmount)}</td>
          <td class="cell-amount">${fmtMoney(r.paidAmount)}</td>
          <td class="cell-amount">${fmtMoney(r.pendingAmount)}</td>
        </tr>
      `).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--text-faint);padding:20px;">No data for this report</td></tr>`;
    } catch (err) {
      toast("error", "Could not load report", err.message);
    }
  }
  $("#runReportBtn")?.addEventListener("click", runReport);
  $("#reportType")?.addEventListener("change", runReport);
  $("#reportStatus")?.addEventListener("change", runReport);

  async function loadTopClients() {
    const tbody = $("#topClientsTable tbody");
    if (!tbody) return;
    try {
      const clients = await api("/api/reports/top-clients");
      tbody.innerHTML = clients.length ? clients.map((c) => `
        <tr>
          <td class="cell-name">${escapeHtml(c.clientName)}</td>
          <td>${escapeHtml(c.businessName) || "—"}</td>
          <td class="cell-amount">${fmtMoney(c.totalBusiness)}</td>
          <td class="cell-amount">${fmtMoney(c.totalPending)}</td>
        </tr>
      `).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--text-faint);padding:20px;">No clients yet</td></tr>`;
    } catch (err) {
      toast("error", "Could not load top clients", err.message);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* CATEGORIES                                                             */
  /* ---------------------------------------------------------------------- */

  function renderCategories() {
    const grid = $("#categoryGrid");
    if (!grid) return;
    grid.innerHTML = state.categories.length ? state.categories.map((c) => `
      <div class="category-chip">
        <span class="cat-name"><i class="fa-solid fa-tag"></i>${escapeHtml(c)}</span>
        <button data-name="${escapeHtml(c)}" title="Delete category"><i class="fa-solid fa-xmark"></i></button>
      </div>
    `).join("") : `<div class="empty-state"><i class="fa-solid fa-tags"></i><p>No categories yet.</p></div>`;

    $$(".category-chip button", grid).forEach((btn) => {
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name;
        const ok = await askConfirm("Delete category?", `"${name}" will be removed from your category list.`);
        if (!ok) return;
        try {
          state.categories = await api(`/api/categories/${encodeURIComponent(name)}`, { method: "DELETE" });
          renderCategories();
          populateCategorySelects();
          toast("success", "Category deleted");
        } catch (err) {
          toast("error", "Could not delete category", err.message);
        }
      });
    });
  }

  $("#addCategoryForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#newCategoryInput");
    const name = input.value.trim();
    if (!name) return;
    try {
      state.categories = await api("/api/categories", { method: "POST", body: JSON.stringify({ name }) });
      input.value = "";
      renderCategories();
      populateCategorySelects();
      toast("success", "Category added");
    } catch (err) {
      toast("error", "Could not add category", err.message);
    }
  });

  /* ---------------------------------------------------------------------- */
  /* EXPORT                                                                 */
  /* ---------------------------------------------------------------------- */

  $("#exportCsvBtn")?.addEventListener("click", () => {
    window.location.href = "/api/export/csv";
  });

  $("#exportExcelBtn")?.addEventListener("click", () => {
    if (typeof XLSX === "undefined") { toast("error", "Excel export unavailable", "Library failed to load."); return; }
    const rows = state.payments.map((p) => ({
      Client: p.clientName, Mobile: p.mobile, Business: p.businessName, Instagram: p.instagram,
      Category: p.category, Date: p.date, Total: p.totalAmount, Paid: p.paidAmount,
      Pending: p.pendingAmount, Status: p.status, "Due Date": p.dueDate, Notes: p.notes
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payments");
    XLSX.writeFile(wb, `payflow-payments-${Date.now()}.xlsx`);
  });

  $("#exportPdfBtn")?.addEventListener("click", () => {
    if (typeof jspdf === "undefined") { toast("error", "PDF export unavailable", "Library failed to load."); return; }
    const { jsPDF } = jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(state.settings.companyName || "PayFlow", 14, 16);
    doc.setFontSize(10);
    doc.text("Payment Summary", 14, 23);
    doc.autoTable({
      startY: 28,
      head: [["Client", "Category", "Total", "Paid", "Pending", "Status", "Date"]],
      body: state.payments.map((p) => [p.clientName, p.category, fmtMoney(p.totalAmount), fmtMoney(p.paidAmount), fmtMoney(p.pendingAmount), p.status, fmtDate(p.date)]),
      styles: { fontSize: 8 }
    });
    doc.save(`payflow-summary-${Date.now()}.pdf`);
  });

  function populateInvoiceSelect() {
    const sel = $("#invoicePaymentSelect");
    if (!sel) return;
    sel.innerHTML = state.payments.map((p) => `<option value="${p.id}">${escapeHtml(p.clientName)} — ${fmtMoney(p.totalAmount)} (${fmtDate(p.date)})</option>`).join("");
  }

  $("#printInvoiceBtn")?.addEventListener("click", () => {
    const id = $("#invoicePaymentSelect")?.value;
    const p = state.payments.find((x) => x.id === id);
    if (!p) { toast("error", "Select a payment first"); return; }
    $("#invoicePrintArea").innerHTML = `
      <h2>${escapeHtml(state.settings.companyName || "PayFlow")}</h2>
      <p>Invoice for: <b>${escapeHtml(p.clientName)}</b> (${escapeHtml(p.mobile)})</p>
      <p>Business: ${escapeHtml(p.businessName) || "—"} &nbsp; Category: ${escapeHtml(p.category)}</p>
      <table border="1" cellpadding="8" cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:16px;">
        <tr><td>Date</td><td>${fmtDate(p.date)}</td></tr>
        <tr><td>Total Amount</td><td>${fmtMoney(p.totalAmount)}</td></tr>
        <tr><td>Paid Amount</td><td>${fmtMoney(p.paidAmount)}</td></tr>
        <tr><td>Pending Amount</td><td>${fmtMoney(p.pendingAmount)}</td></tr>
        <tr><td>Status</td><td>${p.status}</td></tr>
        <tr><td>Notes</td><td>${escapeHtml(p.notes) || "—"}</td></tr>
      </table>
    `;
    window.print();
  });

  /* ---------------------------------------------------------------------- */
  /* BACKUP / RESTORE                                                       */
  /* ---------------------------------------------------------------------- */

  $("#backupBtn")?.addEventListener("click", () => {
    window.location.href = "/api/backup";
  });
  $("#restoreBtn")?.addEventListener("click", () => $("#restoreFileInput").click());
  $("#restoreFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const ok = await askConfirm("Restore backup?", "This will overwrite all current data with the uploaded backup.", "Restore");
    if (!ok) { e.target.value = ""; return; }
    const formData = new FormData();
    formData.append("backupFile", file);
    try {
      await api("/api/restore", { method: "POST", body: formData });
      toast("success", "Backup restored");
      await refreshEverything();
    } catch (err) {
      toast("error", "Restore failed", err.message);
    } finally {
      e.target.value = "";
    }
  });

  /* ---------------------------------------------------------------------- */
  /* Load / refresh                                                        */
  /* ---------------------------------------------------------------------- */

  async function refreshEverything() {
    const [payments, clients, categories, dashboard] = await Promise.all([
      api("/api/payments"),
      api("/api/clients"),
      api("/api/categories"),
      api("/api/dashboard")
    ]);
    state.payments = payments;
    state.clients = clients;
    state.categories = categories;
    state.dashboard = dashboard;

    populateCategorySelects();
    renderDashboard();
    renderPayments();
    if ($("#view-clients")?.classList.contains("active")) renderClients();
    if ($("#view-categories")?.classList.contains("active")) renderCategories();
    if ($("#view-export")?.classList.contains("active")) populateInvoiceSelect();
  }

  async function loadAll() {
    try {
      renderGreeting();
      state.settings = await api("/api/settings");
      applySettingsToUI();
      await refreshEverything();
    } catch (err) {
      toast("error", "Could not load PayFlow", err.message);
    } finally {
      $("#appLoader")?.classList.add("hide");
    }
  }

  loadAll();
})();
