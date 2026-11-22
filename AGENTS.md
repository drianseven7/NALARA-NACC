# AGENTS.md — NALARA OS

## Cara build & verifikasi
- APK dibangun via GitHub Actions (`.github/workflows/build.yml`): AGP 8.7.3, Gradle 8.9 (via `setup-gradle`), Java 17, `gradle assembleDebug`. Tidak ada wrapper `gradlew`; jangan tambah tanpa kebutuhan.
- Sandbox tidak punya Android SDK → verifikasi UI lewat `check_preview` pada `app/src/main/assets/index.html`.

## Backend
- NALARA API: `https://fragrant-rice-1082nalaraos.adrianakbar0202.workers.dev`. Endpoint ada: `/api/health`, `/api/business-units`, `/api/ai-staff`. Belum ada endpoint tasks/projects/audit (404).
- Jimmy Worker: `https://jimmy-ai.adrianakbar0202.workers.dev`. Kontrak: `POST /auth` `{ownerPassword}` → `{success:true}`/`{success:false,error}`; `POST /` `{message,ownerPassword}` → balasan (cek `reply`/`message`/`response`/`content`/`text`).
- Keduanya mengizinkan CORS dari WebView file:// (API pakai `*`; Jimmy echo origin).

## Keamanan (wajib)
- JANGAN tanam GEMINI_API_KEY atau owner password di source code/APK.
- Password owner hanya di `sessionStorage` (kunci `nalara_jimmy_session`), dibersihkan saat putus koneksi. Jangan pindah ke `localStorage`.
- Jangan tambah endpoint tulis publik tanpa autentikasi.
- Jangan ubah Jimmy Worker tanpa kebutuhan/izin.

## Status personel AI
- Enum status: Planned / Configured / Connected / Active / Paused. Jangan tampilkan sebagai Active bila belum benar-benar terkoneksi (render via `statusBadge` di index.html).
