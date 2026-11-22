# AGENTS.md — NALARA OS

## Cara build & verifikasi
- APK dibangun via GitHub Actions (`.github/workflows/build.yml`): AGP 8.7.3, Gradle 8.9 (via `setup-gradle`), Java 17, `gradle assembleDebug`. Tidak ada wrapper `gradlew`; jangan tambah tanpa kebutuhan.
- Sandbox tidak punya Android SDK → verifikasi UI lewat `check_preview` pada `app/src/main/assets/index.html`.

## Backend
- NALARA API: `https://fragrant-rice-1082nalaraos.adrianakbar0202.workers.dev`. Endpoint ada: `/api/health`, `/api/business-units`, `/api/ai-staff`. Belum ada endpoint tasks/projects/audit (404).
- Jimmy Worker: `https://jimmy-ai.adrianakbar0202.workers.dev`. Kontrak: `POST /auth` `{ownerPassword}` → `{success:true}`/`{success:false,error}`; `POST /` `{message,ownerPassword}` → balasan (cek `reply`/`message`/`response`/`content`/`text`).
- Keduanya mengizinkan CORS dari WebView file:// (API pakai `*`; Jimmy echo origin).

## NALARA Tasks Worker (DI-DEPLOY)
- URL: `https://nalara-tasks.adrianakbar0202.workers.dev`
- Kode: `workers/nalara-tasks/worker.js`
- Binding D1: `DB` → `nalara-os-db`
- Secret: `OWNER_PASSWORD` (di-set via wrangler)
- Endpoint (auth `Authorization: Bearer <OWNER_PASSWORD>`, kecuali health): `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`, `GET/POST /api/approvals`, `PATCH /api/approvals/:id`, `GET/POST /api/audit-logs`, `GET /api/reports`, `GET /api/alerts`
- Skema tabel otomatis: tasks (title, unit, priority, status, assignee, description, result, due_date, last_processed_at, created_at), approvals, audit_logs, reports, alerts, **news** (title, source, url, summary, published_at, division, image_url, created_at)
- Endpoint baru: `GET /api/news?division=skema` (publik, tanpa auth), `POST /api/news` dan `DELETE /api/news/:id` (butuh auth `OWNER_PASSWORD`)

## NALARA Orchestrator Worker (DI-DEPLOY, automasi)
- URL: `https://nalara-orchestrator.adrianakbar0202.workers.dev`
- Kode: `workers/nalara-orchestrator/worker.js`
- Binding D1: `DB` → `nalara-os-db`
- Secret: `OWNER_PASSWORD`, `JIMMY_URL` = `https://jimmy-ai.adrianakbar0202.workers.dev`
- Cron Trigger: `*/15 * * * *` (tiap 15 menit) → memanggil `/__cron`
- Manual: `GET /run` dengan auth `Bearer <OWNER_PASSWORD>`
- Pipeline otomatis (setiap 15 menit via cron):
  1. **assignTasks**: tugas pending tanpa assignee → Jimmy menilai dan menugaskan ke Angelia (administrasi) atau Team Research (riset)
  2. **processTasks**: tugas yang sudah punya assignee → dieksekusi via Jimmy/Gemini → hasil disimpan di `result`, status jadi `done`
  3. **generateReport**: laporan harian ke `reports`
  4. **monitor**: tugas terlambat & unit nonaktif → `alerts`
  5. **fetchSkemaNews**: berita divisi skema dari Google News RSS dengan thumbnail (`image_url`) → tabel `news`
- App: halaman Governance menampilkan Auto-pilot + Berita Divisi Skema (dengan gambar ilustrasi); `TASKS_API_BASE` di index.html sudah di-set ke URL Tasks Worker
- UI: total rewrite `index.html` — design system (CSS variables), bottom nav, home dashboard (stats cards), units grid, staff cards, tasks dengan modal form & prioritas warna, Jimmy chat dengan bubble + typing indicator, toast & modal sistem

## Keamanan (wajib)
- JANGAN tanam GEMINI_API_KEY atau owner password di source code/APK.
- Password owner hanya di `sessionStorage` (kunci `nalara_jimmy_session`), dibersihkan saat putus koneksi. Jangan pindah ke `localStorage`.
- Jangan tambah endpoint tulis publik tanpa autentikasi.
- Jangan ubah Jimmy Worker tanpa kebutuhan/izin.

## Status personel AI
- Enum status: Planned / Configured / Connected / Active / Paused. Jangan tampilkan sebagai Active bila belum benar-benar terkoneksi (render via `statusBadge` di index.html).

## Modul lain
- Audit log lokal: key localStorage `nalara_audit_logs` (maks 100 entri), dirender di halaman Governance via `renderAuditLogs`; hook di koneksi Jimmy, tugas, dan penelusuran units/staff.
