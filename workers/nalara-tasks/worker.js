/**
 * NALARA OS — Worker API Tugas, Persetujuan & Audit
 * ---------------------------------------------------
 * Worker Cloudflare mandiri untuk endpoint aman:
 *   tasks, approvals, audit-logs
 *
 * Deploy:
 *   1. Cloudflare -> Workers & Pages -> Create Worker (baru)
 *   2. Tempel kode ini -> Deploy
 *   3. Tambahkan binding D1 bernama `DB` -> database `nalara-os-db`
 *   4. Tambahkan secret `OWNER_PASSWORD` (nilai = owner password)
 *
 * Autentikasi: header `Authorization: Bearer <OWNER_PASSWORD>`
 * (kecuali GET /api/health yang publik).
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };

    // Preflight CORS
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // Health check publik
    if (path === '/api/health' && method === 'GET') {
      return json(
        { success: true, application: 'NALARA OS', service: 'NALARA Tasks API', status: 'online', database: 'connected' },
        corsHeaders
      );
    }

    // Autentikasi untuk semua endpoint lain
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || token !== env.OWNER_PASSWORD) {
      return json({ success: false, error: 'Autentikasi gagal. Token tidak valid.' }, corsHeaders, 401);
    }

    // Pastikan tabel ada
    await ensureTables(env);

    try {
      // ---- TASKS ----
      if (path === '/api/tasks' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM tasks ORDER BY id DESC').all();
        return json({ success: true, data: results }, corsHeaders);
      }

      if (path === '/api/tasks' && method === 'POST') {
        const body = await request.json();
        const title = (body.title || '').trim();
        if (!title) return json({ success: false, error: 'Judul tugas wajib diisi.' }, corsHeaders, 400);
        const unit = (body.unit || '').trim();
        const priority = ['tinggi', 'sedang', 'rendah'].includes(body.priority) ? body.priority : 'sedang';
        const status = ['pending', 'in_progress', 'done'].includes(body.status) ? body.status : 'pending';
        const assignee = (body.assignee || '').trim();
        const dueDate = (body.due_date || '').trim();
        const { meta } = await env.DB.prepare(
          'INSERT INTO tasks (title, unit, priority, status, assignee, due_date) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(title, unit, priority, status, assignee, dueDate).run();
        const { results } = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(meta.last_row_id).all();
        return json({ success: true, data: results[0] || null }, corsHeaders, 201);
      }

      const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
      if (taskMatch && method === 'PATCH') {
        const id = Number(taskMatch[1]);
        const body = await request.json();
        const fields = [];
        const values = [];
        if (body.title !== undefined) { fields.push('title = ?'); values.push(String(body.title).trim()); }
        if (body.unit !== undefined) { fields.push('unit = ?'); values.push(String(body.unit).trim()); }
        if (body.priority !== undefined) {
          if (!['tinggi', 'sedang', 'rendah'].includes(body.priority)) {
            return json({ success: false, error: 'Prioritas tidak valid.' }, corsHeaders, 400);
          }
          fields.push('priority = ?'); values.push(body.priority);
        }
        if (body.status !== undefined) {
          if (!['pending', 'in_progress', 'done'].includes(body.status)) {
            return json({ success: false, error: 'Status tidak valid.' }, corsHeaders, 400);
          }
          fields.push('status = ?'); values.push(body.status);
        }
        if (body.assignee !== undefined) { fields.push('assignee = ?'); values.push(String(body.assignee).trim()); }
        if (body.result !== undefined) { fields.push('result = ?'); values.push(String(body.result)); }
        if (body.due_date !== undefined) { fields.push('due_date = ?'); values.push(String(body.due_date).trim()); }
        if (body.last_processed_at !== undefined) { fields.push('last_processed_at = ?'); values.push(String(body.last_processed_at)); }
        if (!fields.length) return json({ success: false, error: 'Tidak ada kolom yang diperbarui.' }, corsHeaders, 400);
        values.push(id);
        const { meta } = await env.DB.prepare('UPDATE tasks SET ' + fields.join(', ') + ' WHERE id = ?').bind(...values).run();
        if (!meta.changes) return json({ success: false, error: 'Tugas tidak ditemukan.' }, corsHeaders, 404);
        const { results } = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).all();
        return json({ success: true, data: results[0] || null }, corsHeaders);
      }

      if (taskMatch && method === 'DELETE') {
        const id = Number(taskMatch[1]);
        const { meta } = await env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(id).run();
        if (!meta.changes) return json({ success: false, error: 'Tugas tidak ditemukan.' }, corsHeaders, 404);
        return json({ success: true }, corsHeaders);
      }

      // ---- APPROVALS ----
      if (path === '/api/approvals' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM approvals ORDER BY id DESC').all();
        return json({ success: true, data: results }, corsHeaders);
      }

      if (path === '/api/approvals' && method === 'POST') {
        const body = await request.json();
        const subject = (body.subject || '').trim();
        if (!subject) return json({ success: false, error: 'Subjek wajib diisi.' }, corsHeaders, 400);
        const requester = (body.requester || '').trim();
        const description = (body.description || '').trim();
        const { meta } = await env.DB.prepare(
          'INSERT INTO approvals (requester, subject, description) VALUES (?, ?, ?)'
        ).bind(requester, subject, description).run();
        const { results } = await env.DB.prepare('SELECT * FROM approvals WHERE id = ?').bind(meta.last_row_id).all();
        return json({ success: true, data: results[0] || null }, corsHeaders, 201);
      }

      const approvalMatch = path.match(/^\/api\/approvals\/(\d+)$/);
      if (approvalMatch && method === 'PATCH') {
        const id = Number(approvalMatch[1]);
        const body = await request.json();
        const status = body.status;
        if (!['pending', 'approved', 'rejected'].includes(status)) {
          return json({ success: false, error: 'Status persetujuan tidak valid.' }, corsHeaders, 400);
        }
        const reviewedBy = (body.reviewed_by || '').trim();
        const { meta } = await env.DB.prepare(
          'UPDATE approvals SET status = ?, reviewed_by = ? WHERE id = ?'
        ).bind(status, reviewedBy, id).run();
        if (!meta.changes) return json({ success: false, error: 'Permintaan tidak ditemukan.' }, corsHeaders, 404);
        const { results } = await env.DB.prepare('SELECT * FROM approvals WHERE id = ?').bind(id).all();
        return json({ success: true, data: results[0] || null }, corsHeaders);
      }

      // ---- AUDIT LOGS ----
      if (path === '/api/audit-logs' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all();
        return json({ success: true, data: results }, corsHeaders);
      }

      if (path === '/api/audit-logs' && method === 'POST') {
        const body = await request.json();
        const detail = (body.detail || '').trim();
        if (!detail) return json({ success: false, error: 'Detail log wajib diisi.' }, corsHeaders, 400);
        const type = (body.type || 'aksi').trim();
        const { meta } = await env.DB.prepare('INSERT INTO audit_logs (type, detail) VALUES (?, ?)').bind(type, detail).run();
        const { results } = await env.DB.prepare('SELECT * FROM audit_logs WHERE id = ?').bind(meta.last_row_id).all();
        return json({ success: true, data: results[0] || null }, corsHeaders, 201);
      }

      // ---- REPORTS ----
      if (path === '/api/reports' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM reports ORDER BY id DESC LIMIT 50').all();
        return json({ success: true, data: results }, corsHeaders);
      }

      // ---- ALERTS ----
      if (path === '/api/alerts' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM alerts ORDER BY id DESC LIMIT 100').all();
        return json({ success: true, data: results }, corsHeaders);
      }

      // ---- NEWS (Divisi Skema) ----
      if (path === '/api/news' && method === 'GET') {
        const division = url.searchParams.get('division') || 'skema';
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
        const { results } = await env.DB.prepare(
          'SELECT * FROM news WHERE division = ? ORDER BY published_at DESC, id DESC LIMIT ?'
        ).bind(division, limit).all();
        return json({ success: true, data: results, division }, corsHeaders);
      }

      if (path === '/api/news' && method === 'POST') {
        const body = await request.json();
        const title = (body.title || '').trim();
        if (!title) return json({ success: false, error: 'Judul berita wajib diisi.' }, corsHeaders, 400);
        const source = (body.source || '').trim();
        const urlNews = (body.url || '').trim();
        const summary = (body.summary || '').trim();
        const publishedAt = (body.published_at || '').trim();
        const division = (body.division || 'skema').trim();
        const { meta } = await env.DB.prepare(
          'INSERT INTO news (title, source, url, summary, published_at, division) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(title, source, urlNews, summary, publishedAt, division).run();
        const { results } = await env.DB.prepare('SELECT * FROM news WHERE id = ?').bind(meta.last_row_id).all();
        return json({ success: true, data: results[0] || null }, corsHeaders, 201);
      }

      const newsMatch = path.match(/^\/api\/news\/(\d+)$/);
      if (newsMatch && method === 'DELETE') {
        const id = Number(newsMatch[1]);
        const { meta } = await env.DB.prepare('DELETE FROM news WHERE id = ?').bind(id).run();
        if (!meta.changes) return json({ success: false, error: 'Berita tidak ditemukan.' }, corsHeaders, 404);
        return json({ success: true }, corsHeaders);
      }

      return json({ success: false, error: 'Endpoint tidak ditemukan.' }, corsHeaders, 404);
    } catch (e) {
      return json({ success: false, error: 'Kesalahan server: ' + e.message }, corsHeaders, 500);
    }
  },
};

async function ensureTables(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      unit TEXT DEFAULT '',
      priority TEXT DEFAULT 'sedang',
      status TEXT DEFAULT 'pending',
      assignee TEXT DEFAULT '',
      result TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      last_processed_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      requester TEXT DEFAULT '',
      subject TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      reviewed_by TEXT DEFAULT '',
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
    `CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source TEXT DEFAULT '',
      url TEXT DEFAULT '',
      summary TEXT DEFAULT '',
      published_at TEXT DEFAULT '',
      division TEXT DEFAULT 'skema',
      created_at TEXT DEFAULT (datetime('now'))
    )`
  ).run();
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
