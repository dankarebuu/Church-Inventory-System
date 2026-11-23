# 🎸 WINGMACC — Church Band Inventory System

A modern, responsive, real-time inventory management application designed for church music ministries and technical teams. Built with vanilla web standards and powered by a Supabase cloud backend.

---

[https://wingmacc-inventory.netlify.app/](https://wingmacc-inventory.netlify.app/)

---

## ✨ Features

* **🌓 Dual Theme Support:** Modern Minimalist Clean Slate-on-White default theme with an eye-friendly Modern Slate Dark Mode toggle. Includes automatic persistence via `localStorage`.
* **⚡ Real-Time Cloud Synchronization:** Built on Supabase Realtime to push live checklist and status changes across all active sessions instantly.
* **🏷️ Interactive Status & Quick Filters:** Fast filtering by instrument category, loan state, and condition (`Working`, `Needs Repair`, `Missing`).
* **📸 Gear Media Management:** Built-in equipment photo uploads directly to Supabase Cloud Storage buckets.
* **🖨️ Printable Sunday Checklist:** Clean print preview layout designed for paper and PDF export (`html2pdf.js`), complete with sign-off and verification fields.
* **📜 Audit History & Soft Restore:** Comprehensive change log tracking creation, modifications, and deletions, with instant one-click Undo and Restore capabilities.
* **💾 Data Portability:** Seamless multi-format data export (JSON, CSV, PDF) and bulk import capabilities.
* **🔐 Role-Based Access Control:** Guest view-only mode for church volunteers, alongside authenticated dashboard controls for ministry coordinators and team leaders.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3 (CSS Custom Properties / Variables), JavaScript (ES6 Modules & Async/Await)
* **Icons & UI Utilities:** [Lucide Icons](https://lucide.dev/), [html2pdf.js](https://ekoopmans.github.io/html2pdf.js/)
* **Backend & Database:** [Supabase](https://supabase.com/) (PostgreSQL database, Row-Level Security, Auth, Storage, & Realtime)
* **Hosting / Deployment:** GitHub Pages / Vercel

---

## 📁 Project Structure

```text
├── images/
│   └── logo.svg          # Ministry vector brand logo
├── index.html            # Main semantic markup & overlay containers
├── styles.css            # Design tokens, themes, layouts, and responsive queries
├── script.js             # Supabase client integration & client-side app logic
└── README.md             # Project documentation

```
