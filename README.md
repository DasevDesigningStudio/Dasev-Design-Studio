# PayFlow — Payment Manager

A premium, production-ready Payment Manager dashboard built for social media marketing agencies. Track client payments, monitor pending balances, generate reports, and export data — all backed by a lightweight Node.js + Express server with a `data.json` file store (no external database required).

![Stack](https://img.shields.io/badge/stack-Node.js%20%2B%20Express%20%2B%20Vanilla%20JS-12756c)

---

## ✨ Features

- **Dashboard** — total business, received, pending, total clients, monthly income, today's snapshot, payment progress ring, status/monthly/category charts, recent payments & upcoming dues.
- **Payments** — add, edit, delete, duplicate payments with auto-calculated pending amount, search, sort, and filter by category/status.
- **Clients** — auto-derived client directory with total business, received, pending, and full payment history per client.
- **Reports** — daily, weekly, monthly, yearly, category-wise, client-wise, paid/partial/pending breakdowns, and top clients.
- **Categories** — add/remove custom work categories (Post, Reel, Video, Design, Ads, Management, Other, and your own).
- **Export** — Excel (.xlsx), CSV, PDF summary report, and printable client invoices.
- **Backup & Restore** — download a full JSON backup and restore it any time (with an automatic safety snapshot before every restore).
- **Settings** — company name, currency symbol, theme color, and light/dark mode.
- **Premium UI** — teal sidebar, rounded cards, glass/shadow effects, smooth animations, toast notifications, confirmation dialogs, and full mobile/tablet/desktop responsiveness.

---

## 🗂 Project Structure

```
payment-manager/
├── public/
│   ├── index.html      # App shell, all views & modals
│   ├── style.css        # Full design system + responsive rules
│   ├── script.js         # All frontend logic (routing, CRUD, charts, exports)
│   └── assets/            # (static assets, optional)
├── server.js              # Express server + REST API
├── package.json
├── data.json               # Auto-created on first run if missing
└── README.md
```

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start the server

```bash
npm start
```

The app will be available at:

```
http://localhost:3000
```

`data.json` is created automatically on first run if it doesn't already exist, so there's nothing else to configure.

---

## 🔌 REST API Reference

| Method | Endpoint                       | Description                          |
|--------|---------------------------------|---------------------------------------|
| GET    | `/api/payments`                | List all payments                     |
| GET    | `/api/payments/:id`            | Get a single payment                  |
| POST   | `/api/payments`                | Create a payment                      |
| PUT    | `/api/payments/:id`            | Update a payment                      |
| DELETE | `/api/payments/:id`            | Delete a payment                      |
| POST   | `/api/payments/:id/duplicate`  | Duplicate a payment                   |
| GET    | `/api/clients`                 | Client directory (derived)            |
| GET    | `/api/categories`              | List categories                       |
| POST   | `/api/categories`              | Add a category                        |
| DELETE | `/api/categories/:name`        | Remove a category                     |
| GET    | `/api/settings`                | Get settings                          |
| PUT    | `/api/settings`                | Update settings                       |
| GET    | `/api/dashboard`               | Aggregated dashboard stats            |
| GET    | `/api/reports`                 | Grouped report data (query params)    |
| GET    | `/api/reports/top-clients`     | Top 10 clients by business            |
| GET    | `/api/backup`                  | Download full JSON backup             |
| POST   | `/api/restore`                 | Restore from an uploaded backup file  |
| GET    | `/api/export/csv`              | Download payments as CSV              |

---

## 🎨 Design System

- **Sidebar:** deep teal gradient (`#06201f → #0d3f3c`) with a soft glow accent.
- **Surface:** white cards on a light neutral background, 14–24px radii, soft layered shadows.
- **Typography:** Sora (display/headings) + Inter (body) + JetBrains Mono (amounts/data).
- **Dark mode:** full dark palette toggle, persisted to settings.
- **Theme colors:** teal (default), violet, blue, rose — swap the accent color from Settings.

---

## 🖨 Exports

- **Excel (.xlsx)** — generated client-side with SheetJS.
- **CSV** — generated server-side, streamed as a download.
- **PDF report** — generated client-side with jsPDF + AutoTable.
- **Invoice printing** — renders a clean printable invoice and opens the browser print dialog.

---

## 💾 Data Storage

All data lives in a single `data.json` file at the project root:

```json
{
  "payments": [...],
  "categories": [...],
  "settings": { "companyName": "...", "currency": "₹", "themeColor": "teal", "darkMode": false }
}
```

No MySQL, MongoDB, or Firebase — just the file system. Use **Backup → Download Backup** regularly to keep copies safe, and **Backup → Restore** to roll back if needed (a safety snapshot of the previous state is automatically saved to `/backups` before every restore).

---

## 📱 Responsive Behavior

- **Desktop** — full sidebar + multi-column dashboard grid.
- **Tablet** — collapsible sidebar (hamburger menu), 2-column grids.
- **Mobile** — off-canvas sidebar, single-column stacked layout, touch-friendly controls.

---

## 🛠 Tech Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript, Chart.js, SheetJS, jsPDF
- **Backend:** Node.js, Express.js, Multer (file uploads)
- **Storage:** `data.json` (flat-file, zero external database)

---

## License

MIT — free to use and modify for your agency.
