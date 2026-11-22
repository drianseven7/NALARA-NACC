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
- Skema tabel otomatis: tasks, approvals, audit_logs, reports, alerts

## NALARA Orchestrator Worker (DI-DEPLOY, automasi)
- URL: `https://nalara-orchestrator.adrianakbar0202.workers.dev`
- Kode: `workers/nalara-orchestrator/worker.js`
- Binding D1: `DB` → `nalara-os-db`
- Secret: `OWNER_PASSWORD`, `JIMMY_URL` = `https://jimmy-ai.adrianakbar0202.workers.dev`
- Cron Trigger: `*/15 * * * *` (tiap 15 menit) → memanggil `/__cron`
- Manual: `GET /run` dengan auth `Bearer <OWNER_PASSWORD>`
- Pipeline: proses tugas pending ber-assignee via Jimmy/Gemini → simpan `result` & status done; laporan harian ke `reports`; peringatan ke `alerts`
- App: halaman Governance menampilkan Auto-pilot; `TASKS_API_BASE` di index.html sudah di-set ke URL Tasks Worker

## Keamanan (wajib)
- JANGAN tanam GEMINI_API_KEY atau owner password di source code/APK.
- Password owner hanya di `sessionStorage` (kunci `nalara_jimmy_session`), dibersihkan saat putus koneksi. Jangan pindah ke `localStorage`.
- Jangan tambah endpoint tulis publik tanpa autentikasi.
- Jangan ubah Jimmy Worker tanpa kebutuhan/izin.

## Status personel AI
- Enum status: Planned / Configured / Connected / Active / Paused. Jangan tampilkan sebagai Active bila belum benar-benar terkoneksi (render via `statusBadge` di index.html).

## Modul lain
- Audit log lokal: key localStorage `nalara_audit_logs` (maks 100 entri), dirender di halaman Governance via `renderAuditLogs`; hook di koneksi Jimmy, tugas, dan penelusuran units/staff.
