/* ============================================================================
   AgencyOS — Client Management
   Frontend Logic (Vanilla JS)
   ============================================================================ */

const API_BASE = '/api';

const state = {
  overview: null,
  oneTimeJobs: [],
  packages: [],
  platformMaster: [],
  filters: {
    onetime: 'all',
    packages: 'all'
  }
};

/* -------------------------------------------------------------------------- */
/* Utility Functions                                                          */
/* -------------------------------------------------------------------------- */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function fmtMoney(num) {
  return '₹' + (Number(num) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function fmtDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function showToast(message, type = 'success') {
  const container = $('#toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-text"><b>${type === 'success' ? 'Success' : 'Notice'}</b><span>${message}</span></div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

/* -------------------------------------------------------------------------- */
/* Navigation & Tabs                                                          */
/* -------------------------------------------------------------------------- */
function initNav() {
  $$('.nav-item[data-view]').forEach(nav => {
    nav.addEventListener('click', (e) => {
      e.preventDefault();
      const view = nav.dataset.view;
      
      // Update Sidebar
      $$('.nav-item').forEach(n => n.classList.remove('active'));
      nav.classList.add('active');
      
      // Update Views
      $$('.view').forEach(v => v.classList.remove('active'));
      $(`#view-${view}`).classList.add('active');

      // Refresh Data based on view
      if (view === 'overview') loadOverview();
      if (view === 'onetime') loadOneTime();
      if (view === 'packages') loadPackages();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Data Fetching & Rendering                                                  */
/* -------------------------------------------------------------------------- */

// --- 1. OVERVIEW ---
async function loadOverview() {
  try {
    const res = await fetch(`${API_BASE}/overview`);
    const data = await res.json();
    state.overview = data;

    $('#ovLifetimeRev').textContent = fmtMoney(data.lifetimeRevenue);
    $('#ovOutstanding').textContent = fmtMoney(data.outstandingRollup);

    $('#otTotal').textContent = data.oneTime.total;
    $('#otActive').textContent = data.oneTime.active;
    $('#otOnHold').textContent = data.oneTime.onHold;
    $('#otCompleted').textContent = data.oneTime.completed;
    $('#otPayPending').textContent = data.oneTime.paymentPending;

    $('#pkgTotal').textContent = data.packages.total;
    $('#pkgActive').textContent = data.packages.active;
    $('#pkgOnHold').textContent = data.packages.onHold;
    $('#pkgCompleted').textContent = data.packages.completed;
    $('#pkgPayPending').textContent = data.packages.paymentPending;
  } catch (err) {
    console.error("Failed to load overview", err);
  }
}

// --- 2. ONE-TIME JOBS ---
async function loadOneTime() {
  try {
    const res = await fetch(`${API_BASE}/onetime`);
    state.oneTimeJobs = await res.json();
    renderOneTimeTable();
  } catch (err) {
    console.error(err);
  }
}

function renderOneTimeTable() {
  const tbody = $('#oneTimeTable tbody');
  const filtered = state.oneTimeJobs.filter(j => 
    state.filters.onetime === 'all' || j.status === state.filters.onetime
  );

  tbody.innerHTML = filtered.map(job => {
    const paymentStatus = job.paidAmount >= job.totalAmount && job.totalAmount > 0 ? 'Paid' : (job.paidAmount > 0 ? 'Partial' : 'Pending');
    return `
      <tr>
        <td><b>${job.jobName}</b><br/><span style="font-size: 11px; color: var(--text-muted);">${job.clientName}</span></td>
        <td><span class="badge" style="background:var(--bg); color:var(--text);">${job.category}</span></td>
        <td style="font-size: 12px;">Start: ${fmtDate(job.startDate)}<br/>Due: ${fmtDate(job.dueDate)}</td>
        <td>${job.unitsDone} / ${job.unitsTotal} Done</td>
        <td>${fmtMoney(job.totalAmount)} <br/><span style="font-size:11px; color:var(--text-muted);">Paid: ${fmtMoney(job.paidAmount)}</span></td>
        <td>
          <span class="badge ${job.status.replace(' ', '.')}">${job.status}</span>
          <span class="badge ${paymentStatus}" style="margin-left:5px;">${paymentStatus}</span>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" style="text-align:center;">No jobs found.</td></tr>';
}

// --- 3. PACKAGES ---
async function loadPackages() {
  try {
    const res = await fetch(`${API_BASE}/packages`);
    const data = await res.json();
    state.packages = data.packages;
    state.platformMaster = data.platformMaster;
    renderPackagesTable();
  } catch (err) {
    console.error(err);
  }
}

function renderPackagesTable() {
  const tbody = $('#packagesTable tbody');
  const filtered = state.packages.filter(p => 
    state.filters.packages === 'all' || p.status === state.filters.packages
  );

  tbody.innerHTML = filtered.map(pkg => {
    let progressTxt = "";
    if (pkg.packageType === "Post & Reel") {
      const t = pkg.posts.total + pkg.reels.total + pkg.stories.total;
      const d = pkg.posts.done + pkg.reels.done + pkg.stories.done;
      progressTxt = `${d} / ${t} Items`;
    } else {
      progressTxt = "Ongoing Management";
    }

    const paymentStatus = pkg.paidAmount >= pkg.totalAmount && pkg.totalAmount > 0 ? 'Paid' : (pkg.paidAmount > 0 ? 'Partial' : 'Pending');

    return `
      <tr>
        <td><b>${pkg.packageName}</b><br/><span style="font-size: 11px; color: var(--text-muted);">${pkg.clientName}</span></td>
        <td><span class="badge" style="background:var(--bg); color:var(--text);">${pkg.packageType}</span></td>
        <td style="font-size: 12px;">Start: ${fmtDate(pkg.startDate)}<br/>End: ${fmtDate(pkg.endDate)}</td>
        <td>${progressTxt}</td>
        <td>${fmtMoney(pkg.totalAmount)} <br/><span style="font-size:11px; color:var(--text-muted);">Paid: ${fmtMoney(pkg.paidAmount)}</span></td>
        <td>
          <span class="badge ${pkg.status.replace(' ', '.')}">${pkg.status}</span>
          <span class="badge ${paymentStatus}" style="margin-left:5px;">${paymentStatus}</span>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6" style="text-align:center;">No packages found.</td></tr>';
}

/* -------------------------------------------------------------------------- */
/* Modals & Forms                                                             */
/* -------------------------------------------------------------------------- */

function initModals() {
  // ONE-TIME MODAL
  $('#addOneTimeBtn').addEventListener('click', () => {
    $('#formOneTime').reset();
    $('#otStartDate').value = new Date().toISOString().slice(0, 10);
    $('#modalOneTime').hidden = false;
  });
  $('#closeOneTime').addEventListener('click', () => $('#modalOneTime').hidden = true);

  $('#formOneTime').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      jobName: $('#otJobName').value,
      clientName: $('#otClientName').value,
      category: $('#otCategory').value,
      status: $('#otStatus').value,
      startDate: $('#otStartDate').value,
      dueDate: $('#otDueDate').value,
      unitsTotal: parseInt($('#otTotalUnits').value) || 1,
      unitsDone: parseInt($('#otUnitsDone').value) || 0,
      totalAmount: parseFloat($('#otTotalAmt').value) || 0,
      paidAmount: parseFloat($('#otPaidAmt').value) || 0
    };

    await fetch(`${API_BASE}/onetime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    $('#modalOneTime').hidden = true;
    showToast('One-Time Job Added');
    loadOneTime();
    loadOverview();
  });

  // PACKAGE MODALS
  $('#addPackageInitBtn').addEventListener('click', () => {
    $('#modalPackageTypeSelect').hidden = false;
  });
  $('#closePkgTypeSelect').addEventListener('click', () => $('#modalPackageTypeSelect').hidden = true);

  // Type Selection Actions
  $('#btnTypePostReel').addEventListener('click', () => openPackageForm('Post & Reel'));
  $('#btnTypeManagement').addEventListener('click', () => openPackageForm('Management'));
  $('#closePackage').addEventListener('click', () => $('#modalPackage').hidden = true);

  $('#formPackage').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = $('#pkgType').value;
    const payload = {
      packageName: $('#pkgName').value,
      clientName: $('#pkgClient').value,
      packageType: type,
      status: $('#pkgStatus').value,
      startDate: $('#pkgStartDate').value,
      endDate: $('#pkgEndDate').value,
      totalAmount: parseFloat($('#pkgTotalAmt').value) || 0,
      paidAmount: parseFloat($('#pkgPaidAmt').value) || 0
    };

    if (type === 'Post & Reel') {
      payload.posts = { total: parseInt($('#prPostsTotal').value)||0, done: parseInt($('#prPostsDone').value)||0 };
      payload.reels = { total: parseInt($('#prReelsTotal').value)||0, done: parseInt($('#prReelsDone').value)||0 };
      payload.stories = { total: parseInt($('#prStoriesTotal').value)||0, done: parseInt($('#prStoriesDone').value)||0 };
    }

    // (Management payload logic for platforms can be extracted here via DOM parsing if needed)

    await fetch(`${API_BASE}/packages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    $('#modalPackage').hidden = true;
    showToast(`${type} Package Added`);
    loadPackages();
    loadOverview();
  });
}

function openPackageForm(type) {
  $('#modalPackageTypeSelect').hidden = true;
  $('#formPackage').reset();
  $('#pkgType').value = type;
  $('#pkgTypeBadge').textContent = type;
  $('#pkgStartDate').value = new Date().toISOString().slice(0, 10);
  
  if (type === 'Post & Reel') {
    $('#sectionPostReel').hidden = false;
    $('#sectionManagement').hidden = true;
  } else {
    $('#sectionPostReel').hidden = true;
    $('#sectionManagement').hidden = false;
    renderPlatformMasterRows();
  }
  
  $('#modalPackage').hidden = false;
}

function renderPlatformMasterRows() {
  const tbody = $('#pkgPlatformTable tbody');
  tbody.innerHTML = state.platformMaster.map((platform, idx) => `
    <tr>
      <td style="font-weight:600;">${platform}</td>
      <td><input type="checkbox" checked /></td>
      <td><input type="number" min="0" value="0" style="width:60px;" /></td>
      <td><input type="number" min="0" value="0" style="width:60px;" /></td>
      <td><input type="number" min="0" value="0" style="width:60px;" /></td>
      <td></td>
    </tr>
  `).join('');
}

/* -------------------------------------------------------------------------- */
/* Filter Setup                                                               */
/* -------------------------------------------------------------------------- */
function initFilters() {
  // One-Time Filters
  $$('#view-onetime .filter-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      $$('#view-onetime .filter-tab').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.filters.onetime = e.target.dataset.filter;
      renderOneTimeTable();
    });
  });

  // Package Filters
  $$('#view-packages .filter-tab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      $$('#view-packages .filter-tab').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.filters.packages = e.target.dataset.filter;
      renderPackagesTable();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initModals();
  initFilters();
  
  // Set today's date in Topbar
  $('#topbarDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long' });
  
  // Initial load
  loadOverview();
});