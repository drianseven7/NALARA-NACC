/**
 * NALARA OS — Orchestrator Worker (Agen Bertindak)
 * ---------------------------------------------------
 * Sistem orkestrasi otomatis untuk Jimmy & agen AI:
 *   - Menugaskan tugas baru ke agen yang tepat (Angelia / Team Research)
 *   - Mengeksekusi tugas via Jimmy/Gemini → simpan hasil & status done
 *   - Membuat laporan harian
 *   - Memantau tugas terlambat & unit nonaktif
 *   - Mengambil berita divisi skema dengan gambar dari Google News RSS
 *
 * Dipicu oleh Cloudflare Cron Trigger pada rute /__cron (tiap 15 menit).
 * Manual trigger (dengan auth): GET /run
 *
 * Semua eksekusi nyata lewat API Jimmy/Gemini — tidak ada simulasi.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Manual trigger (dengan auth) untuk pengujian
    if (path === '/run') {
      const authHeader = request.headers.get('Authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!token || token !== env.OWNER_PASSWORD) {
        return json({ success: false, error: 'Autentikasi gagal.' }, null, 401);
      }
      await ensureTables(env);
      const result = await runPipeline(env);
      return json({ success: true, ...result });
    }

    // Cron trigger dari Cloudflare
    if (path === '/__cron') {
      await ensureTables(env);
      const result = await runPipeline(env);
      return json({ success: true, ...result });
    }

    return json({ success: false, error: 'Endpoint tidak ditemukan.' }, null, 404);
  },
};

async function runPipeline(env) {
  const assigned = await assignTasks(env);
  const processed = await processTasks(env);
  const report = await generateReport(env);
  const alerts = await monitor(env);
  const news = await fetchSkemaNews(env);
  return { assigned, processed, report, alerts, news };
}

// ---- 1. Tugaskan tugas baru ke agen yang tepat ----
async function assignTasks(env) {
  const LIMIT = 5;
  const { results } = await env.DB.prepare(
    `SELECT * FROM tasks WHERE status = 'pending' AND (assignee IS NULL OR assignee = '') ORDER BY id ASC LIMIT ?`
  ).bind(LIMIT).all();

  let assigned = 0;
  for (const task of results) {
    try {
      const prompt = buildAssignmentPrompt(task);
      const data = await callJimmy(env, prompt);
      const output = extractReply(data).trim().toLowerCase();

      let assignee = 'Angelia'; // default
      if (output.includes('research') || output.includes('team research') || output.includes('riset')) {
        assignee = 'Team Research';
      } else if (output.includes('angelia') || output.includes('administrasi') || output.includes('admin')) {
        assignee = 'Angelia';
      }

      await env.DB.prepare(
        `UPDATE tasks SET assignee = ? WHERE id = ?`
      ).bind(assignee, task.id).run();
      await appendAudit(env, 'auto_assign', 'Tugas #' + task.id + ' ("' + task.title + '") ditugaskan ke ' + assignee);
      assigned++;
    } catch (e) {
      await appendAudit(env, 'auto_error', 'Gagal tugaskan tugas #' + task.id + ': ' + e.message);
    }
  }
  return assigned;
}

function buildAssignmentPrompt(task) {
  return (
    'Anda adalah Chief of Staff AI NALARA GROUP. Tugas berikut belum ditugaskan ke siapa. ' +
    'Tentukan agen AI yang paling tepat untuk menyelesaikannya, pilih SATU dari dua opsi:\n' +
    '1. Angelia — Corporate Secretary (administrasi, korespondensi, dokumen, rapat, keuangan umum)\n' +
    '2. Team Research — Research Officer (riset, analisis data, survei, tren, berita, laporan riset)\n\n' +
    'Tugas: ' + task.title + '\n' +
    'Deskripsi: ' + (task.description || '(tidak ada)') + '\n' +
    'Unit: ' + (task.unit || 'Umum') + '\n' +
    'Prioritas: ' + task.priority + '\n\n' +
    'Jawab hanya dengan nama agen: "Angelia" atau "Team Research". Tambahkan alasan singkat jika perlu.'
  );
}

// ---- 2. Eksekusi tugas yang sudah ditugaskan ----
async function processTasks(env) {
  const LIMIT = 5;
  const { results } = await env.DB.prepare(
    `SELECT * FROM tasks WHERE status = 'pending' AND assignee != '' AND (last_processed_at IS NULL OR last_processed_at = '') ORDER BY id ASC LIMIT ?`
  ).bind(LIMIT).all();

  let processed = 0;
  for (const task of results) {
    try {
      const prompt = buildTaskPrompt(task);
      const data = await callJimmy(env, prompt);
      const output = extractReply(data);
      const ts = now();
      await env.DB.prepare(
        `UPDATE tasks SET result = ?, status = 'done', last_processed_at = ? WHERE id = ?`
      ).bind(output, ts, task.id).run();
      await appendAudit(env, 'auto_task', 'Tugas #' + task.id + ' ("' + task.title + '") dieksekusi oleh ' + task.assignee);
      processed++;
    } catch (e) {
      await appendAudit(env, 'auto_error', 'Gagal proses tugas #' + task.id + ': ' + e.message);
    }
  }
  return processed;
}

function buildTaskPrompt(task) {
  return (
    'Anda adalah ' + task.assignee + ', personel AI NALARA GROUP. Kerjakan tugas berikut secara mandiri dan berikan hasil akhirnya (output siap pakai):\n' +
    'Tugas: ' + task.title + '\n' +
    'Deskripsi: ' + (task.description || '(tidak ada)') + '\n' +
    'Unit: ' + (task.unit || 'Umum') + '\n' +
    'Prioritas: ' + task.priority + '\n' +
    'Batas waktu: ' + (task.due_date || 'tidak ada') + '\n' +
    'Berikan hasil konkret (mis. draf konten, ringkasan, atau langkah eksekusi).'
  );
}

// ---- 3. Laporan harian ----
async function generateReport(env) {
  const today = todayStr();
  const existing = await env.DB.prepare('SELECT id FROM reports WHERE period = ?').bind(today).first();
  if (existing) return { skipped: true };

  const taskStats = await env.DB.prepare(
    `SELECT COUNT(*) AS total, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS done, SUM(CASE WHEN status!='done' THEN 1 ELSE 0 END) AS pending FROM tasks`
  ).first();
  const units = await env.DB.prepare('SELECT COUNT(*) AS n FROM business_units').first();
  const staff = await env.DB.prepare('SELECT COUNT(*) AS n FROM ai_staff').first();

  const message =
    'Buat laporan status harian NALARA GROUP:\n' +
    '- Total tugas: ' + (taskStats.total || 0) + ' (selesai ' + (taskStats.done || 0) + ', pending ' + (taskStats.pending || 0) + ')\n' +
    '- Unit bisnis: ' + (units.n || 0) + '\n' +
    '- Personel AI: ' + (staff.n || 0) + '\n' +
    'Sajikan ringkas, profesional, dalam Bahasa Indonesia.';

  try {
    const data = await callJimmy(env, message);
    const summary = extractReply(data);
    await env.DB.prepare('INSERT INTO reports (period, summary) VALUES (?, ?)').bind(today, summary).run();
    await appendAudit(env, 'auto_report', 'Laporan harian ' + today + ' dibuat');
    return { created: true };
  } catch (e) {
    await appendAudit(env, 'auto_error', 'Gagal buat laporan: ' + e.message);
    return { created: false, error: e.message };
  }
}

// ---- 4. Pemantauan ----
async function monitor(env) {
  let alertsAdded = 0;
  const today = todayStr();

  // Tugas terlambat
  const overdue = await env.DB.prepare(
    `SELECT id, title, due_date FROM tasks WHERE status != 'done' AND due_date != '' AND due_date < ? LIMIT 10`
  ).bind(today).all();
  for (const t of overdue.results) {
    const msg = 'Tugas terlambat: "' + t.title + '" (batas ' + t.due_date + ')';
    const dup = await env.DB.prepare('SELECT id FROM alerts WHERE message = ? AND date(created_at) = ?').bind(msg, today).first();
    if (!dup) {
      await env.DB.prepare('INSERT INTO alerts (severity, message) VALUES (?, ?)').bind('warning', msg).run();
      alertsAdded++;
    }
  }

  // Unit nonaktif
  const inactive = await env.DB.prepare(
    `SELECT name FROM business_units WHERE status != 'active' LIMIT 10`
  ).all();
  for (const u of inactive.results) {
    const msg = 'Unit bisnis belum aktif: ' + u.name;
    const dup = await env.DB.prepare('SELECT id FROM alerts WHERE message = ? AND date(created_at) = ?').bind(msg, today).first();
    if (!dup) {
      await env.DB.prepare('INSERT INTO alerts (severity, message) VALUES (?, ?)').bind('info', msg).run();
      alertsAdded++;
    }
  }

  return alertsAdded;
}

// ---- 5. Pencarian berita divisi Skema dengan gambar (otomatis) ----
async function fetchSkemaNews(env) {
  let added = 0;
  try {
    const rssUrl = 'https://news.google.com/rss/search?q=skema+NALARA+OR+skema+bisnis+OR+divisi+skema&hl=id-ID&gl=ID&ceid=ID:id';
    const res = await fetch(rssUrl);
    const xml = await res.text();

    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
      const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
      const pubDateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
      const sourceMatch = item.match(/<source[^>]*>([\s\S]*?)<\/source>/);
      // Gambar ilustrasi dari media:thumbnail atau enclosure
      const thumbMatch = item.match(/<media:thumbnail[^>]*url="([^"]*)"/i);
      const encMatch = item.match(/<enclosure[^>]*url="([^"]*)"[^>]*type="image\/[^"]*"/i);

      const title = titleMatch ? titleMatch[1].trim() : '';
      const urlNews = linkMatch ? linkMatch[1].trim() : '';
      const publishedAt = pubDateMatch ? pubDateMatch[1].trim() : '';
      const source = sourceMatch ? sourceMatch[1].trim() : 'Google News';
      const imageUrl = (thumbMatch ? thumbMatch[1] : (encMatch ? encMatch[1] : '')).trim();

      if (!title || !urlNews) continue;

      const exists = await env.DB.prepare('SELECT id FROM news WHERE title = ? AND division = ?').bind(title, 'skema').first();
      if (exists) continue;

      await env.DB.prepare(
        'INSERT INTO news (title, source, url, summary, published_at, division, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(title, source, urlNews, '', publishedAt, 'skema', imageUrl).run();
      await appendAudit(env, 'auto_news', 'Berita skema baru: ' + title);
      added++;
    }
  } catch (e) {
    await appendAudit(env, 'auto_error', 'Gagal ambil berita skema: ' + e.message);
  }
  return added;
}

// ---- Helper ----
async function callJimmy(env, message) {
  const base = (env.JIMMY_URL || 'https://jimmy-ai.adrianakbar0202.workers.dev').replace(/\/$/, '');
  const res = await fetch(base + '/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, ownerPassword: env.OWNER_PASSWORD }),
  });
  return res.json();
}

function extractReply(data) {
  if (!data) return '';
  if (typeof data.reply === 'string') return data.reply;
  if (typeof data.message === 'string') return data.message;
  if (typeof data.response === 'string') return data.response;
  if (typeof data.content === 'string') return data.content;
  if (typeof data.text === 'string') return data.text;
  return JSON.stringify(data);
}

async function appendAudit(env, type, detail) {
  try {
    await env.DB.prepare('INSERT INTO audit_logs (type, detail) VALUES (?, ?)').bind(type, detail).run();
  } catch (e) {}
}

function now() {
  return new Date().toISOString();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function ensureTables(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      unit TEXT DEFAULT '',
      priority TEXT DEFAULT 'sedang',
      status TEXT DEFAULT 'pending',
      assignee TEXT DEFAULT '',
      description TEXT DEFAULT '',
      result TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      last_processed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT DEFAULT '',
      summary TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      severity TEXT DEFAULT 'info',
      message TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT DEFAULT 'aksi',
      detail TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source TEXT DEFAULT '',
      url TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      published_at TEXT DEFAULT '',
      division TEXT DEFAULT 'skema',
      image_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();
}
