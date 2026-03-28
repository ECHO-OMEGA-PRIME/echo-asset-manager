// Echo Asset Manager v1.0.0 — AI-Powered Asset & Portfolio Management
// Cloudflare Worker — D1 + KV

interface Env { DB: D1Database; AM_CACHE: KVNamespace; ENGINE_RUNTIME: Fetcher; SHARED_BRAIN: Fetcher; EMAIL_SENDER: Fetcher; ECHO_API_KEY: string; }
interface RLState { c: number; t: number }

function sanitize(s: string, max = 2000): string { return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, max); }
async function rateLimit(kv: KVNamespace, key: string, limit: number, windowSec: number): Promise<boolean> {
  const k = `rl:${key}`; const raw = await kv.get(k); const now = Date.now();
  let st: RLState = raw ? JSON.parse(raw) : { c: 0, t: now };
  const decay = ((now - st.t) / 1000) * (limit / windowSec); st.c = Math.max(0, st.c - decay); st.t = now;
  if (st.c >= limit) return false; st.c += 1;
  await kv.put(k, JSON.stringify(st), { expirationTtl: windowSec * 2 }); return true;
}
function authOk(req: Request, env: Env): boolean { const h = req.headers.get('X-Echo-API-Key') || req.headers.get('Authorization')?.replace('Bearer ', '') || ''; return h === env.ECHO_API_KEY; }
function slog(level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) { const entry = { ts: new Date().toISOString(), level, worker: 'echo-asset-manager', version: '1.0.1', msg, ...data }; if (level === 'error') console.error(JSON.stringify(entry)); else console.log(JSON.stringify(entry)); }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }); }
function err(msg: string, status = 400) { slog('warn', msg, { status }); return json({ error: msg }, status); }

function calcDepreciation(cost: number, salvage: number, lifeMonths: number, monthsElapsed: number, method: string): { monthly: number; accumulated: number; bookValue: number } {
  const depreciable = cost - salvage;
  if (method === 'declining_balance') {
    const rate = 2 / (lifeMonths / 12); let bv = cost; let acc = 0;
    for (let m = 0; m < Math.min(monthsElapsed, lifeMonths); m++) {
      const dep = Math.max((bv * rate) / 12, 0); if (bv - dep < salvage) { acc += bv - salvage; bv = salvage; break; }
      acc += dep; bv -= dep;
    }
    return { monthly: monthsElapsed > 0 ? acc / monthsElapsed : 0, accumulated: acc, bookValue: cost - acc };
  }
  // straight_line default
  const monthly = depreciable / lifeMonths;
  const acc = Math.min(monthly * monthsElapsed, depreciable);
  return { monthly, accumulated: acc, bookValue: cost - acc };
}


// Security headers
const SEC_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};
function withSecHeaders(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url); const p = url.pathname; const m = req.method;
    if (m === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Echo-API-Key,Authorization' } });
    if (p === '/') return json({ service: 'echo-asset-manager', status: 'operational' });
    if (p === '/health') return json({ ok: true, service: 'echo-asset-manager', version: '1.0.0', timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19) });
    if (m === 'GET') { const ip = req.headers.get('CF-Connecting-IP') || 'unknown'; if (!await rateLimit(env.AM_CACHE, `get:${ip}`, 60, 60)) return err('Rate limited', 429); }
    if (m !== 'GET' && m !== 'OPTIONS' && !authOk(req, env)) return err('Unauthorized', 401);

    try {
      // ── Organizations ──
      if (p === '/orgs' && m === 'GET') { return json((await env.DB.prepare('SELECT * FROM organizations WHERE status=? ORDER BY name').bind('active').all()).results); }
      if (p === '/orgs' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO organizations (name,slug,currency,fiscal_year_start,depreciation_method,settings) VALUES (?,?,?,?,?,?)').bind(sanitize(b.name), sanitize(b.slug || b.name.toLowerCase().replace(/\s+/g, '-')), b.currency || 'USD', b.fiscal_year_start || 1, b.depreciation_method || 'straight_line', JSON.stringify(b.settings || {})).run(); return json({ id: r.meta.last_row_id }, 201); }

      // ── Users ──
      if (p === '/users' && m === 'GET') { const orgId = url.searchParams.get('org_id'); return json((await env.DB.prepare('SELECT * FROM users WHERE org_id=? AND status=? ORDER BY name').bind(orgId, 'active').all()).results); }
      if (p === '/users' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO users (org_id,name,email,role) VALUES (?,?,?,?)').bind(b.org_id, sanitize(b.name), sanitize(b.email), b.role || 'viewer').run(); return json({ id: r.meta.last_row_id }, 201); }

      // ── Categories ──
      if (p === '/categories' && m === 'GET') { const orgId = url.searchParams.get('org_id'); return json((await env.DB.prepare('SELECT * FROM asset_categories WHERE org_id=? ORDER BY name').bind(orgId).all()).results); }
      if (p === '/categories' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO asset_categories (org_id,name,parent_id,depreciation_method,useful_life_years,salvage_percent,icon) VALUES (?,?,?,?,?,?,?)').bind(b.org_id, sanitize(b.name), b.parent_id || null, b.depreciation_method || 'straight_line', b.useful_life_years || 5, b.salvage_percent || 0, b.icon || null).run(); return json({ id: r.meta.last_row_id }, 201); }

      // ── Locations ──
      if (p === '/locations' && m === 'GET') { const orgId = url.searchParams.get('org_id'); return json((await env.DB.prepare('SELECT * FROM locations WHERE org_id=? AND status=? ORDER BY name').bind(orgId, 'active').all()).results); }
      if (p === '/locations' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO locations (org_id,name,address,building,floor,room,gps_lat,gps_lon) VALUES (?,?,?,?,?,?,?,?)').bind(b.org_id, sanitize(b.name), sanitize(b.address || ''), sanitize(b.building || ''), sanitize(b.floor || ''), sanitize(b.room || ''), b.gps_lat || null, b.gps_lon || null).run(); return json({ id: r.meta.last_row_id }, 201); }

      // ── Assets ──
      if (p === '/assets' && m === 'GET') {
        const orgId = url.searchParams.get('org_id'); const status = url.searchParams.get('status') || 'active';
        const catId = url.searchParams.get('category_id'); const locId = url.searchParams.get('location_id');
        let q = 'SELECT a.*,c.name as category_name,l.name as location_name,u.name as assigned_to_name FROM assets a LEFT JOIN asset_categories c ON a.category_id=c.id LEFT JOIN locations l ON a.location_id=l.id LEFT JOIN users u ON a.assigned_to=u.id WHERE a.org_id=? AND a.status=?';
        const binds: any[] = [orgId, status];
        if (catId) { q += ' AND a.category_id=?'; binds.push(catId); }
        if (locId) { q += ' AND a.location_id=?'; binds.push(locId); }
        q += ' ORDER BY a.name';
        return json((await env.DB.prepare(q).bind(...binds).all()).results);
      }
      if (p === '/assets' && m === 'POST') {
        const b: any = await req.json();
        const tag = b.asset_tag || `AST-${Date.now().toString(36).toUpperCase()}`;
        const r = await env.DB.prepare('INSERT INTO assets (org_id,asset_tag,name,description,category_id,location_id,assigned_to,serial_number,model,manufacturer,purchase_date,purchase_price,current_value,salvage_value,useful_life_months,depreciation_method,warranty_expiry,insurance_policy,insurance_expiry,condition,barcode,custom_fields,tags) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(b.org_id, sanitize(tag), sanitize(b.name), sanitize(b.description || ''), b.category_id || null, b.location_id || null, b.assigned_to || null, sanitize(b.serial_number || ''), sanitize(b.model || ''), sanitize(b.manufacturer || ''), b.purchase_date || null, b.purchase_price || 0, b.purchase_price || 0, b.salvage_value || 0, b.useful_life_months || 60, b.depreciation_method || 'straight_line', b.warranty_expiry || null, sanitize(b.insurance_policy || ''), b.insurance_expiry || null, b.condition || 'good', sanitize(b.barcode || ''), JSON.stringify(b.custom_fields || {}), JSON.stringify(b.tags || [])).run();
        await env.DB.prepare('INSERT INTO assignment_history (asset_id,assigned_to,location_id,action,notes) VALUES (?,?,?,?,?)').bind(r.meta.last_row_id, b.assigned_to, b.location_id, 'created', 'Asset created').run();
        return json({ id: r.meta.last_row_id, asset_tag: tag }, 201);
      }
      const assetMatch = p.match(/^\/assets\/(\d+)$/);
      if (assetMatch && m === 'GET') {
        const asset = await env.DB.prepare('SELECT a.*,c.name as category_name,l.name as location_name,u.name as assigned_to_name FROM assets a LEFT JOIN asset_categories c ON a.category_id=c.id LEFT JOIN locations l ON a.location_id=l.id LEFT JOIN users u ON a.assigned_to=u.id WHERE a.id=?').bind(assetMatch[1]).first();
        if (!asset) return err('Not found', 404);
        const maint = (await env.DB.prepare('SELECT * FROM maintenance_records WHERE asset_id=? ORDER BY created_at DESC LIMIT 10').bind(assetMatch[1]).all()).results;
        const history = (await env.DB.prepare('SELECT h.*,u.name as user_name FROM assignment_history h LEFT JOIN users u ON h.assigned_to=u.id WHERE h.asset_id=? ORDER BY h.created_at DESC LIMIT 20').bind(assetMatch[1]).all()).results;
        const vals = (await env.DB.prepare('SELECT * FROM valuations WHERE asset_id=? ORDER BY valuation_date DESC LIMIT 5').bind(assetMatch[1]).all()).results;
        const depSched = (await env.DB.prepare('SELECT * FROM depreciation_schedule WHERE asset_id=? ORDER BY period_start DESC LIMIT 12').bind(assetMatch[1]).all()).results;
        return json({ ...asset, maintenance: maint, history, valuations: vals, depreciation_schedule: depSched });
      }
      if (assetMatch && m === 'PUT') {
        const b: any = await req.json(); const fields: string[] = []; const vals: any[] = [];
        for (const [k, v] of Object.entries(b)) {
          if (['name','description','category_id','location_id','assigned_to','serial_number','model','manufacturer','condition','warranty_expiry','insurance_policy','insurance_expiry','status','custom_fields','tags'].includes(k)) {
            fields.push(`${k}=?`); vals.push(typeof v === 'string' ? sanitize(v as string) : (typeof v === 'object' ? JSON.stringify(v) : v));
          }
        }
        if (fields.length) { fields.push("updated_at=datetime('now')"); vals.push(assetMatch[1]); await env.DB.prepare(`UPDATE assets SET ${fields.join(',')} WHERE id=?`).bind(...vals).run(); }
        if (b.assigned_to !== undefined || b.location_id !== undefined) { await env.DB.prepare('INSERT INTO assignment_history (asset_id,assigned_to,location_id,action,notes) VALUES (?,?,?,?,?)').bind(assetMatch[1], b.assigned_to || null, b.location_id || null, 'updated', sanitize(b.notes || 'Asset updated')).run(); }
        return json({ updated: true });
      }

      // ── Depreciation ──
      const assetDepr = p.match(/^\/assets\/(\d+)\/depreciation$/);
      if (assetDepr && m === 'GET') {
        const asset = await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(assetDepr[1]).first() as any;
        if (!asset) return err('Not found', 404);
        const purchaseDate = new Date(asset.purchase_date || asset.created_at);
        const now = new Date(); const monthsElapsed = Math.max(0, (now.getFullYear() - purchaseDate.getFullYear()) * 12 + (now.getMonth() - purchaseDate.getMonth()));
        const dep = calcDepreciation(asset.purchase_price, asset.salvage_value, asset.useful_life_months, monthsElapsed, asset.depreciation_method);
        return json({ asset_id: asset.id, method: asset.depreciation_method, purchase_price: asset.purchase_price, salvage_value: asset.salvage_value, useful_life_months: asset.useful_life_months, months_elapsed: monthsElapsed, monthly_depreciation: Math.round(dep.monthly * 100) / 100, accumulated_depreciation: Math.round(dep.accumulated * 100) / 100, current_book_value: Math.round(dep.bookValue * 100) / 100 });
      }

      // ── Dispose Asset ──
      const assetDispose = p.match(/^\/assets\/(\d+)\/dispose$/);
      if (assetDispose && m === 'POST') {
        const b: any = await req.json();
        await env.DB.prepare("UPDATE assets SET status='disposed',disposed_at=datetime('now'),disposal_method=?,disposal_value=?,updated_at=datetime('now') WHERE id=?").bind(sanitize(b.method || 'sold'), b.value || 0, assetDispose[1]).run();
        await env.DB.prepare('INSERT INTO assignment_history (asset_id,action,notes) VALUES (?,?,?)').bind(assetDispose[1], 'disposed', `Method: ${b.method || 'sold'}, Value: ${b.value || 0}`).run();
        return json({ disposed: true });
      }

      // ── Check In/Out ──
      if (p === '/check-in-out' && m === 'POST') {
        const b: any = await req.json();
        await env.DB.prepare('INSERT INTO check_in_out (asset_id,user_id,action,condition_before,condition_after,notes) VALUES (?,?,?,?,?,?)').bind(b.asset_id, b.user_id, b.action, sanitize(b.condition_before || ''), sanitize(b.condition_after || ''), sanitize(b.notes || '')).run();
        if (b.action === 'check_out') { await env.DB.prepare('UPDATE assets SET assigned_to=?,updated_at=datetime(\'now\') WHERE id=?').bind(b.user_id, b.asset_id).run(); }
        if (b.action === 'check_in') { await env.DB.prepare("UPDATE assets SET assigned_to=NULL,updated_at=datetime('now') WHERE id=?").bind(b.asset_id).run(); }
        return json({ recorded: true }, 201);
      }

      // ── Maintenance ──
      if (p === '/maintenance' && m === 'GET') { const assetId = url.searchParams.get('asset_id'); const status = url.searchParams.get('status'); let q = 'SELECT m.*,a.name as asset_name FROM maintenance_records m JOIN assets a ON m.asset_id=a.id WHERE m.asset_id=?'; const binds: any[] = [assetId]; if (status) { q += ' AND m.status=?'; binds.push(status); } q += ' ORDER BY m.scheduled_date DESC'; return json((await env.DB.prepare(q).bind(...binds).all()).results); }
      if (p === '/maintenance' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO maintenance_records (asset_id,type,description,performed_by,cost,scheduled_date,next_due_date,status) VALUES (?,?,?,?,?,?,?,?)').bind(b.asset_id, b.type || 'preventive', sanitize(b.description || ''), sanitize(b.performed_by || ''), b.cost || 0, b.scheduled_date || null, b.next_due_date || null, b.status || 'scheduled').run(); return json({ id: r.meta.last_row_id }, 201); }
      const maintComplete = p.match(/^\/maintenance\/(\d+)\/complete$/);
      if (maintComplete && m === 'POST') { const b: any = await req.json(); await env.DB.prepare("UPDATE maintenance_records SET status='completed',completed_date=datetime('now'),cost=?,notes=? WHERE id=?").bind(b.cost || 0, sanitize(b.notes || ''), maintComplete[1]).run(); return json({ completed: true }); }

      // ── Valuations ──
      if (p === '/valuations' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO valuations (asset_id,valuation_date,market_value,book_value,replacement_cost,appraiser,method,notes) VALUES (?,?,?,?,?,?,?,?)').bind(b.asset_id, b.valuation_date || new Date().toISOString().slice(0, 10), b.market_value || null, b.book_value || null, b.replacement_cost || null, sanitize(b.appraiser || ''), sanitize(b.method || ''), sanitize(b.notes || '')).run(); if (b.market_value) await env.DB.prepare("UPDATE assets SET current_value=?,updated_at=datetime('now') WHERE id=?").bind(b.market_value, b.asset_id).run(); return json({ id: r.meta.last_row_id }, 201); }

      // ── Insurance ──
      if (p === '/insurance' && m === 'GET') { const orgId = url.searchParams.get('org_id'); return json((await env.DB.prepare('SELECT * FROM insurance_policies WHERE org_id=? ORDER BY end_date DESC').bind(orgId).all()).results); }
      if (p === '/insurance' && m === 'POST') { const b: any = await req.json(); const r = await env.DB.prepare('INSERT INTO insurance_policies (org_id,policy_number,provider,coverage_type,premium,deductible,coverage_amount,start_date,end_date) VALUES (?,?,?,?,?,?,?,?,?)').bind(b.org_id, sanitize(b.policy_number), sanitize(b.provider || ''), sanitize(b.coverage_type || ''), b.premium || 0, b.deductible || 0, b.coverage_amount || 0, b.start_date || null, b.end_date || null).run(); return json({ id: r.meta.last_row_id }, 201); }

      // ── Dashboard ──
      if (p === '/dashboard' && m === 'GET') {
        const orgId = url.searchParams.get('org_id');
        const total = (await env.DB.prepare("SELECT COUNT(*) as c, SUM(current_value) as v, SUM(purchase_price) as cost FROM assets WHERE org_id=? AND status='active'").bind(orgId).first()) as any;
        const disposed = (await env.DB.prepare("SELECT COUNT(*) as c, SUM(disposal_value) as v FROM assets WHERE org_id=? AND status='disposed'").bind(orgId).first()) as any;
        const byCat = (await env.DB.prepare("SELECT c.name, COUNT(*) as count, SUM(a.current_value) as value FROM assets a JOIN asset_categories c ON a.category_id=c.id WHERE a.org_id=? AND a.status='active' GROUP BY c.id ORDER BY value DESC").bind(orgId).all()).results;
        const byLoc = (await env.DB.prepare("SELECT l.name, COUNT(*) as count FROM assets a JOIN locations l ON a.location_id=l.id WHERE a.org_id=? AND a.status='active' GROUP BY l.id ORDER BY count DESC").bind(orgId).all()).results;
        const upcomingMaint = (await env.DB.prepare("SELECT m.*,a.name as asset_name FROM maintenance_records m JOIN assets a ON m.asset_id=a.id WHERE a.org_id=? AND m.status='scheduled' AND m.scheduled_date <= date('now','+30 days') ORDER BY m.scheduled_date LIMIT 10").bind(orgId).all()).results;
        const warrantyExpiring = (await env.DB.prepare("SELECT id,name,asset_tag,warranty_expiry FROM assets WHERE org_id=? AND status='active' AND warranty_expiry IS NOT NULL AND warranty_expiry <= date('now','+60 days') AND warranty_expiry >= date('now') ORDER BY warranty_expiry LIMIT 10").bind(orgId).all()).results;
        const totalDep = (await env.DB.prepare("SELECT SUM(accumulated_depreciation) as total FROM assets WHERE org_id=? AND status='active'").bind(orgId).first()) as any;
        return json({ total_assets: total?.c || 0, total_value: total?.v || 0, total_cost: total?.cost || 0, total_depreciation: totalDep?.total || 0, disposed_count: disposed?.c || 0, disposed_value: disposed?.v || 0, by_category: byCat, by_location: byLoc, upcoming_maintenance: upcomingMaint, warranty_expiring: warrantyExpiring });
      }

      // ── AI Condition Assessment ──
      const aiAssess = p.match(/^\/ai\/assess\/(\d+)$/);
      if (aiAssess && m === 'GET') {
        const asset = await env.DB.prepare('SELECT * FROM assets WHERE id=?').bind(aiAssess[1]).first() as any;
        if (!asset) return err('Not found', 404);
        const maint = (await env.DB.prepare('SELECT * FROM maintenance_records WHERE asset_id=? ORDER BY created_at DESC LIMIT 5').bind(aiAssess[1]).all()).results;
        try {
          const aiResp = await env.ENGINE_RUNTIME.fetch('https://engine/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine_id: 'MECH01', query: `Assess condition and recommend maintenance for: ${asset.name} (${asset.manufacturer} ${asset.model}). Age: ${asset.purchase_date || 'unknown'}. Condition: ${asset.condition}. Recent maintenance: ${JSON.stringify(maint)}`, max_doctrines: 3 }) });
          const aiData: any = await aiResp.json();
          return json({ assessment: aiData.answer || aiData.response || 'Assessment unavailable' });
        } catch { return json({ assessment: 'AI assessment temporarily unavailable' }); }
      }

      // ── AI Depreciation Forecast ──
      if (p === '/ai/depreciation-forecast' && m === 'POST') {
        const b: any = await req.json();
        try {
          const assets = (await env.DB.prepare("SELECT name,purchase_price,current_value,salvage_value,useful_life_months,depreciation_method,purchase_date FROM assets WHERE org_id=? AND status='active' ORDER BY purchase_price DESC LIMIT 20").bind(b.org_id).all()).results;
          const aiResp = await env.ENGINE_RUNTIME.fetch('https://engine/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ engine_id: 'TX01', query: `Forecast depreciation impact for the next 12 months. Assets: ${JSON.stringify(assets)}. Analyze tax implications and recommend optimal depreciation strategies.`, max_doctrines: 5 }) });
          const aiData: any = await aiResp.json();
          return json({ forecast: aiData.answer || aiData.response || 'Forecast unavailable' });
        } catch { return json({ forecast: 'AI forecast temporarily unavailable' }); }
      }

      // ── Export ──
      if (p === '/export' && m === 'GET') {
        const orgId = url.searchParams.get('org_id'); const format = url.searchParams.get('format') || 'json';
        const rows = (await env.DB.prepare("SELECT a.*,c.name as category_name,l.name as location_name FROM assets a LEFT JOIN asset_categories c ON a.category_id=c.id LEFT JOIN locations l ON a.location_id=l.id WHERE a.org_id=? ORDER BY a.name").bind(orgId).all()).results as any[];
        if (format === 'csv' && rows.length) {
          const headers = Object.keys(rows[0]);
          const csv = [headers.join(','), ...rows.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
          return new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="assets-export.csv"', 'Access-Control-Allow-Origin': '*' } });
        }
        return json(rows);
      }

      return err('Not found', 404);
    } catch (e: any) { slog('error', 'Internal error', { error: e.message, path: p }); return json({ error: 'Internal error', detail: e.message }, 500); }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const now = new Date().toISOString().slice(0, 10);
    // Daily depreciation update for all active assets
    const assets = (await env.DB.prepare("SELECT * FROM assets WHERE status='active' AND purchase_date IS NOT NULL").all()).results as any[];
    for (const asset of assets) {
      const pd = new Date(asset.purchase_date); const nd = new Date();
      const months = Math.max(0, (nd.getFullYear() - pd.getFullYear()) * 12 + (nd.getMonth() - pd.getMonth()));
      const dep = calcDepreciation(asset.purchase_price, asset.salvage_value, asset.useful_life_months, months, asset.depreciation_method);
      await env.DB.prepare("UPDATE assets SET accumulated_depreciation=?,current_value=?,updated_at=datetime('now') WHERE id=?").bind(Math.round(dep.accumulated * 100) / 100, Math.round(dep.bookValue * 100) / 100, asset.id).run();
    }
    // Daily report snapshots per org
    const orgs = (await env.DB.prepare("SELECT id FROM organizations WHERE status='active'").all()).results as any[];
    for (const org of orgs) {
      const stats = (await env.DB.prepare("SELECT COUNT(*) as total, SUM(current_value) as value, SUM(accumulated_depreciation) as dep, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active FROM assets WHERE org_id=?").bind(org.id).first()) as any;
      const maintCost = (await env.DB.prepare("SELECT SUM(cost) as c FROM maintenance_records m JOIN assets a ON m.asset_id=a.id WHERE a.org_id=? AND m.completed_date >= date('now','-1 day')").bind(org.id).first()) as any;
      await env.DB.prepare('INSERT OR REPLACE INTO reports_daily (org_id,date,total_assets,total_value,total_depreciation,assets_in_service,maintenance_cost) VALUES (?,?,?,?,?,?,?)').bind(org.id, now, stats?.total || 0, stats?.value || 0, stats?.dep || 0, stats?.active || 0, maintCost?.c || 0).run();
    }
  },
};
