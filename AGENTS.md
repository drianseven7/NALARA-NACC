# AGENTS.md — NALARA OS

## Cara build & verifikasi
- APK dibangun via GitHub Actions (`.github/workflows/build.yml`): AGP 8.7.3, Gradle 8.9 (via `setup-gradle`), Java 17, `gradle assembleDebug`. Tidak ada wrapper `gradlew`; jangan tambah tanpa kebutuhan.
- Sandbox tidak punya Android SDK → verifikasi UI lewat `check_preview` pada `app/src/main/assets/index.html`.

## Backend
- NALARA API: `https://fragrant-rice-1082nalaraos.adrianakbar0202.workers.dev`. Endpoint ada: `/api/health`, `/api/business-units`, `/api/ai-staff`. Belum ada endpoint tasks/projects/audit (404).
- Jimmy Worker: `https://jimmy-ai.adrianakbar0202.workers.dev`. Kontrak: `POST /auth` `{ownerPassword}` → `{success:true}`/`{success:false,error}`; `POST /` `{message,ownerPassword}` → balasan (cek `reply`/`message`/`response`/`content`/`text`).
- Keduanya mengizinkan CORS dari WebView file:// (API pakai `*`; Jimmy echo origin).

## NALARA Tasks Worker (baru)
- Kode: `workers/nalara-tasks/worker.js` (Cloudflare Worker mandiri, belum di-deploy).
- Deploy: buat Worker baru di Cloudflare → tempel kode → binding D1 `DB` → `nalara-os-db` → secret `OWNER_PASSWORD`.
- Endpoint (auth `Authorization: Bearer <OWNER_PASSWORD>`, kecuali health): `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`, `GET/POST /api/approvals`, `PATCH /api/approvals/:id`, `GET/POST /api/audit-logs`.
- Skema tabel dibuat otomatis (`CREATE TABLE IF NOT EXISTS`): tasks(title,unit,priority,status,assignee), approvals(requester,subject,description,status,reviewed_by), audit_logs(type,detail).

## Keamanan (wajib)
- JANGAN tanam GEMINI_API_KEY atau owner password di source code/APK.
- Password owner hanya di `sessionStorage` (kunci `nalara_jimmy_session`), dibersihkan saat putus koneksi. Jangan pindah ke `localStorage`.
- Jangan tambah endpoint tulis publik tanpa autentikasi.
- Jangan ubah Jimmy Worker tanpa kebutuhan/izin.

## Status personel AI
- Enum status: Planned / Configured / Connected / Active / Paused. Jangan tampilkan sebagai Active bila belum benar-benar terkoneksi (render via `statusBadge` di index.html).

## Modul lain
- Audit log lokal: key localStorage `nalara_audit_logs` (maks 100 entri), dirender di halaman Governance via `renderAuditLogs`; hook di koneksi Jimmy, tugas, dan penelusuran units/staff.
