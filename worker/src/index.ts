// Infinite Email - Alias Management API v1 + Web Console
// Uses D1 for storage (aliases, rules, audit)

import { connect } from 'cloudflare:sockets';

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // Health check
    if (path === '/health') {
      return new Response('ok')
    }

    // Get token from header or query string (for web console)
    const token = request.headers.get('X-Admin-Token') || url.searchParams.get('token')
    const isAuthorized = token && token === env.ADMIN_TOKEN

    // Auth check for API endpoints
    if (!isAuthorized && path.startsWith('/api/')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Web Console - Return HTML
    if (path === '/' || path === '/console') {
      return new Response(getConsoleHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    }

    // API Routes
    try {
      // GET /api/aliases - List all aliases (with optional service filter)
      if (path === '/api/aliases' && method === 'GET') {
        const serviceFilter = url.searchParams.get('service')
        const statusFilter = url.searchParams.get('status')
        
        let query = 'SELECT alias, status, created_at, note, service, purpose FROM aliases'
        const params: any[] = []
        const conditions: string[] = []
        
        if (serviceFilter) {
          conditions.push('service = ?')
          params.push(serviceFilter)
        }
        if (statusFilter) {
          conditions.push('status = ?')
          params.push(statusFilter)
        }
        
        if (conditions.length > 0) {
          query += ' WHERE ' + conditions.join(' AND ')
        }
        
        query += ' ORDER BY created_at DESC LIMIT 100'
        
        const stmt = env.DB.prepare(query)
        const results = params.length > 0 ? await stmt.bind(...params).all() : await stmt.all()
        
        // Log audit
        await logAudit(env, null, 'list_aliases', request, { service: serviceFilter })
        
        return Response.json({ aliases: results.results || [] })
      }

      // POST /api/aliases - Create new alias
      if (path === '/api/aliases' && method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const prefix = (body.prefix || 'alias').toString().slice(0, 32)
        const note = (body.note || '').toString().slice(0, 256)
        
        // Generate alias with timestamp and random suffix
        const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        const alias = `${prefix}-${ts}-${crypto.randomUUID().slice(0, 8)}`
        const fullAddress = env.DOMAIN ? `${alias}@${env.DOMAIN}` : alias

        // Insert into D1
        const stmt = env.DB.prepare(`
          INSERT INTO aliases (alias, status, note) VALUES (?, 'active', ?)
        `)
        await stmt.bind(alias, note).run()

        // Log audit
        await logAudit(env, alias, 'create_alias', request, { note, fullAddress })

        return Response.json({
          alias,
          address: fullAddress,
          status: 'active',
          note
        }, { status: 201 })
      }

      // POST /api/aliases/bulk - Bulk create aliases
      if (path === '/api/aliases/bulk' && method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const service = (body.service || '').toString().slice(0, 32)
        const count = Math.min(parseInt(body.count) || 1, 50)  // Max 50
        const purpose = (body.purpose || '').toString().slice(0, 128)
        const note = (body.note || '').toString().slice(0, 256)

        if (!service) {
          return Response.json({ error: 'service is required' }, { status: 400 })
        }

        // Generate alias format: service-yyyymm-rand(6~8)
        const now = new Date()
        const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`
        const randLen = 6 + Math.floor(Math.random() * 3)  // 6-8 chars
        
        const results: any[] = []
        const errors: string[] = []

        for (let i = 0; i < count; i++) {
          const rand = crypto.randomUUID().slice(0, randLen)
          const alias = `${service}-${yyyymm}-${rand}`
          const fullAddress = env.DOMAIN ? `${alias}@${env.DOMAIN}` : alias

          try {
            const stmt = env.DB.prepare(`
              INSERT INTO aliases (alias, status, note, service, purpose) VALUES (?, 'active', ?, ?, ?)
            `)
            await stmt.bind(alias, note, service, purpose).run()

            results.push({
              alias,
              address: fullAddress,
              status: 'active',
              note,
              service,
              purpose
            })
          } catch (e: any) {
            errors.push(`Failed to create ${alias}: ${e.message}`)
          }
        }

        // Log audit for bulk action
        await logAudit(env, null, 'bulk_create', request, { 
          service, 
          count: results.length, 
          purpose,
          requested: count,
          created: results.length
        })

        return Response.json({
          created: results.length,
          requested: count,
          aliases: results,
          errors: errors.length > 0 ? errors : undefined
        }, { status: errors.length === count ? 500 : 201 })
      }

      // DELETE /api/aliases/:alias - Revoke alias
      if (path.match(/^\/api\/aliases\/(.+)$/) && method === 'DELETE') {
        const alias = path.match(/^\/api\/aliases\/(.+)$/)[1]
        
        // Check if exists
        const checkStmt = env.DB.prepare('SELECT status FROM aliases WHERE alias = ?')
        const existing = await checkStmt.bind(alias).first()

        if (!existing) {
          return Response.json({ error: 'Alias not found' }, { status: 404 })
        }

        // Update status to revoked
        const updateStmt = env.DB.prepare(`
          UPDATE aliases SET status = 'revoked' WHERE alias = ?
        `)
        await updateStmt.bind(alias).run()

        // Log audit
        await logAudit(env, alias, 'revoke_alias', request)

        return Response.json({ alias, status: 'revoked' })
      }

      // POST /api/rules - Create new rule
      if (path === '/api/rules' && method === 'POST') {
        const body = await request.json().catch(() => ({}))
        const type = body.type
        const value = (body.value || '').toString().slice(0, 128)

        // Validate type
        const validTypes = ['allow_prefix', 'deny_prefix', 'allow_exact', 'deny_exact']
        if (!type || !validTypes.includes(type)) {
          return Response.json({ 
            error: 'Invalid rule type',
            valid_types: validTypes 
          }, { status: 400 })
        }

        if (!value) {
          return Response.json({ error: 'Value is required' }, { status: 400 })
        }

        // Insert rule
        try {
          const stmt = env.DB.prepare(`
            INSERT INTO rules (type, value) VALUES (?, ?)
          `)
          await stmt.bind(type, value).run()

          // Log audit
          await logAudit(env, null, 'create_rule', request, { type, value })

          return Response.json({ type, value, status: 'created' }, { status: 201 })
        } catch (e: any) {
          if (e.message?.includes('UNIQUE constraint failed')) {
            return Response.json({ error: 'Rule already exists' }, { status: 409 })
          }
          throw e
        }
      }

      // GET /api/rules - List rules
      if (path === '/api/rules' && method === 'GET') {
        const stmt = env.DB.prepare(`
          SELECT id, type, value, created_at 
          FROM rules 
          ORDER BY created_at DESC
        `)
        const results = await stmt.all()

        return Response.json({ rules: results.results || [] })
      }

      // GET /api/audit - List audit logs
      if (path === '/api/audit' && method === 'GET') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)
        const stmt = env.DB.prepare(`
          SELECT id, ts, alias, action, ip, details 
          FROM audit 
          ORDER BY ts DESC
          LIMIT ?
        `)
        const results = await stmt.bind(limit).all()

        return Response.json({ audit: results.results || [] })
      }

      // GET /api/codefetch - Fetch verification codes from email
      if (path === '/api/codefetch' && method === 'GET') {
        const service = url.searchParams.get('service') || ''
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50)
        
        // Check if IMAP is configured
        if (!env.IMAP_USER || !env.IMAP_PASS || !env.IMAP_HOST) {
          return Response.json({ 
            error: 'IMAP not configured',
            message: 'Add IMAP_USER, IMAP_PASS, IMAP_HOST to Worker secrets'
          }, { status: 500 })
        }

        try {
          const codes = await fetchVerificationCodes(env, service, limit)
          return Response.json({ codes, service, count: codes.length })
        } catch (e: any) {
          return Response.json({ 
            error: 'Failed to fetch codes',
            message: e.message 
          }, { status: 500 })
        }
      }

    } catch (e: any) {
      console.error('API Error:', e)
      return Response.json({ 
        error: 'Internal error',
        message: e.message 
      }, { status: 500 })
    }

    return new Response('Not found', { status: 404 })
  },
}

// Helper: Log audit entry
async function logAudit(env: any, alias: string | null, action: string, request: Request, details?: any) {
  try {
    const ip = request.headers.get('CF-Connecting-IP') || null
    const detailsStr = details ? JSON.stringify(details) : null
    
    const stmt = env.DB.prepare(`
      INSERT INTO audit (alias, action, ip, details) VALUES (?, ?, ?, ?)
    `)
    await stmt.bind(alias, action, ip, detailsStr).run()
  } catch (e) {
    console.error('Audit log failed:', e)
  }
}

// Helper: Fetch verification codes via IMAP (simplified - using direct socket)
async function fetchVerificationCodes(env: any, service: string, limit: number): Promise<any[]> {
  // This is a placeholder - in production you'd use a proper IMAP library
  // For now, return empty array if IMAP not fully configured
  if (!env.IMAP_USER || !env.IMAP_PASS || !env.IMAP_HOST) {
    return []
  }
  
  // Note: Full IMAP implementation would go here
  // For simplicity, returning empty - the web console handles this gracefully
  return []
}

// Web Console HTML
function getConsoleHTML(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Infinite Email Console</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0d1117;
      --bg2: #161b22;
      --bg3: #21262d;
      --text: #c9d1d9;
      --text2: #8b949e;
      --primary: #58a6ff;
      --success: #3fb950;
      --danger: #f85149;
      --border: #30363d;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 16px;
      line-height: 1.5;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: var(--primary); }
    h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
    
    /* Auth Modal */
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.8);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
    }
    .modal-overlay.hidden { display: none; }
    .modal {
      background: var(--bg2); border: 1px solid var(--border);
      padding: 24px; border-radius: 8px; width: 90%; max-width: 360px;
    }
    .modal h2 { margin-top: 0; }
    input, select {
      width: 100%; padding: 10px 12px; margin: 8px 0;
      background: var(--bg); border: 1px solid var(--border);
      color: var(--text); border-radius: 6px; font-size: 14px;
    }
    input:focus, select:focus { outline: none; border-color: var(--primary); }
    button {
      background: var(--primary); color: #fff; border: none;
      padding: 10px 16px; border-radius: 6px; cursor: pointer;
      font-size: 14px; width: 100%; margin-top: 8px;
    }
    button:hover { opacity: 0.9; }
    button.danger { background: var(--danger); }
    button.secondary { background: var(--bg3); }
    
    /* Sections */
    .section {
      background: var(--bg2); border: 1px solid var(--border);
      border-radius: 8px; padding: 16px; margin-bottom: 16px;
    }
    .section-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
    }
    
    /* Forms */
    .form-row { display: flex; gap: 8px; margin-bottom: 8px; }
    .form-row input { flex: 1; margin: 0; }
    .form-row button { width: auto; flex-shrink: 0; }
    
    /* Table */
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%; border-collapse: collapse; font-size: 13px;
    }
    th, td {
      text-align: left; padding: 8px; border-bottom: 1px solid var(--border);
    }
    th { color: var(--text2); font-weight: 500; }
    .status { 
      padding: 2px 8px; border-radius: 12px; font-size: 11px;
    }
    .status.active { background: rgba(63,185,80,0.2); color: var(--success); }
    .status.revoked { background: rgba(248,81,73,0.2); color: var(--danger); }
    
    /* Code display */
    .code-item {
      background: var(--bg); padding: 12px; border-radius: 6px;
      margin-bottom: 8px; border: 1px solid var(--border);
    }
    .code-item .code {
      font-family: monospace; font-size: 1.2rem; color: var(--success);
      letter-spacing: 2px;
    }
    .code-item .meta {
      font-size: 12px; color: var(--text2); margin-top: 4px;
    }
    
    /* Alias list */
    .alias-item {
      display: flex; justify-content: space-between; align-items: center;
      padding: 8px; border-bottom: 1px solid var(--border);
    }
    .alias-item:last-child { border-bottom: none; }
    .alias-item .address {
      font-family: monospace; font-size: 13px;
    }
    .alias-item .actions { display: flex; gap: 8px; }
    .alias-item button {
      padding: 4px 8px; font-size: 11px; width: auto;
    }
    
    /* Search */
    .search-bar {
      display: flex; gap: 8px; margin-bottom: 12px;
    }
    .search-bar input { flex: 1; margin: 0; }
    
    /* Hidden */
    .hidden { display: none !important; }
    
    /* Toast */
    .toast {
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      background: var(--bg3); border: 1px solid var(--border);
      padding: 12px 20px; border-radius: 8px; font-size: 14px;
      z-index: 200; animation: fadeIn 0.2s;
    }
    @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>📧 Infinite Email Console</h1>
    
    <!-- Auth Modal -->
    <div id="authModal" class="modal-overlay">
      <div class="modal">
        <h2>🔐 Admin Token</h2>
        <p style="color: var(--text2); font-size: 13px; margin-bottom: 12px;">
          请输入 Admin Token 以访问控制台
        </p>
        <input type="password" id="tokenInput" placeholder="输入 Admin Token">
        <button onclick="authenticate()">验证</button>
      </div>
    </div>
    
    <!-- Main Content -->
    <div id="mainContent" class="hidden">
      
      <!-- Generate Alias -->
      <div class="section">
        <div class="section-header">
          <h2>✨ 生成别名</h2>
        </div>
        <div class="form-row">
          <input type="text" id="serviceInput" placeholder="Service (如: google, amazon)">
          <input type="number" id="countInput" placeholder="数量" value="5" min="1" max="50" style="width: 80px;">
          <button onclick="generateAliases()">生成</button>
        </div>
        <div id="generatedAliases" class="hidden">
          <div class="search-bar" style="margin-top: 12px;">
            <input type="text" id="generatedList" readonly placeholder="生成的别名将显示在这里" style="font-family: monospace;">
            <button class="secondary" onclick="copyGenerated()">复制</button>
          </div>
        </div>
      </div>
      
      <!-- Alias List -->
      <div class="section">
        <div class="section-header">
          <h2>📋 别名列表</h2>
          <button class="secondary" onclick="loadAliases()" style="width: auto; padding: 4px 12px;">刷新</button>
        </div>
        <div class="search-bar">
          <input type="text" id="searchInput" placeholder="搜索别名或 service..." oninput="filterAliases()">
          <select id="statusFilter" onchange="filterAliases()" style="width: 100px;">
            <option value="">全部状态</option>
            <option value="active">Active</option>
            <option value="revoked">Revoked</option>
          </select>
        </div>
        <div id="aliasesList"></div>
      </div>
      
      <!-- Verification Codes -->
      <div class="section">
        <div class="section-header">
          <h2>🔢 验证码获取</h2>
        </div>
        <div class="form-row">
          <input type="text" id="codeServiceInput" placeholder="Service (可选, 如: google)">
          <button onclick="fetchCodes()">获取验证码</button>
        </div>
        <div id="codesList"></div>
      </div>
    </div>
  </div>
  
  <div id="toast" class="toast hidden"></div>

  <script>
    const API_BASE = '';
    let token = localStorage.getItem('adminToken') || '';
    let allAliases = [];
    
    // Auth
    function authenticate() {
      token = document.getElementById('tokenInput').value.trim();
      if (!token) return showToast('请输入 Token');
      localStorage.setItem('adminToken', token);
      document.getElementById('authModal').classList.add('hidden');
      document.getElementById('mainContent').classList.remove('hidden');
      loadAliases();
    }
    
    // Check auth on load
    if (token) {
      document.getElementById('authModal').classList.add('hidden');
      document.getElementById('mainContent').classList.remove('hidden');
      loadAliases();
    }
    
    // API helper
    async function apiCall(endpoint, options = {}) {
      const headers = { 'X-Admin-Token': token, ...options.headers };
      const res = await fetch(API_BASE + endpoint, { ...options, headers });
      if (res.status === 401) {
        showToast('Token 无效，请重新输入');
        localStorage.removeItem('adminToken');
        location.reload();
        return null;
      }
      return res.json();
    }
    
    // Generate Aliases
    async function generateAliases() {
      const service = document.getElementById('serviceInput').value.trim();
      const count = parseInt(document.getElementById('countInput').value) || 5;
      
      if (!service) return showToast('请输入 Service 名称');
      
      const data = await apiCall('/api/aliases/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ service, count })
      });
      
      if (data && data.aliases) {
        const list = data.aliases.map(a => a.address).join('\\n');
        document.getElementById('generatedList').value = list;
        document.getElementById('generatedAliases').classList.remove('hidden');
        showToast(\`生成了 \${data.created} 个别名\`);
        loadAliases();
      } else if (data && data.error) {
        showToast(data.error);
      }
    }
    
    function copyGenerated() {
      const input = document.getElementById('generatedList');
      input.select();
      document.execCommand('copy');
      showToast('已复制到剪贴板');
    }
    
    // Load Aliases
    async function loadAliases() {
      const data = await apiCall('/api/aliases');
      if (data && data.aliases) {
        allAliases = data.aliases;
        filterAliases();
      }
    }
    
    // Filter Aliases
    function filterAliases() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const status = document.getElementById('statusFilter').value;
      
      const filtered = allAliases.filter(a => {
        const matchSearch = !search || 
          a.alias?.toLowerCase().includes(search) || 
          a.service?.toLowerCase().includes(search) ||
          a.note?.toLowerCase().includes(search);
        const matchStatus = !status || a.status === status;
        return matchSearch && matchStatus;
      });
      
      renderAliases(filtered);
    }
    
    // Render Aliases
    function renderAliases(aliases) {
      const container = document.getElementById('aliasesList');
      if (!aliases.length) {
        container.innerHTML = '<p style="color: var(--text2); text-align: center; padding: 20px;">暂无别名</p>';
        return;
      }
      
      container.innerHTML = aliases.map(a => \`
        <div class="alias-item">
          <div>
            <div class="address">\${a.alias || a.address || 'N/A'}</div>
            <div style="font-size: 11px; color: var(--text2);">
              \${a.service || ''} \${a.purpose ? '· ' + a.purpose : ''}
            </div>
          </div>
          <div class="actions">
            <span class="status \${a.status}">\${a.status}</span>
            \${a.status === 'active' ? \`<button class="danger" onclick="revokeAlias('\${a.alias}')">吊销</button>\` : ''}
          </div>
        </div>
      \`).join('');
    }
    
    // Revoke Alias
    async function revokeAlias(alias) {
      if (!confirm(\`确定要吊销 \${alias} 吗？\`)) return;
      
      const data = await apiCall('/api/aliases/' + alias, { method: 'DELETE' });
      if (data && data.status === 'revoked') {
        showToast('别名已吊销');
        loadAliases();
      }
    }
    
    // Fetch Codes
    async function fetchCodes() {
      const service = document.getElementById('codeServiceInput').value.trim();
      const container = document.getElementById('codesList');
      container.innerHTML = '<p style="color: var(--text2);">正在获取...</p>';
      
      const url = '/api/codefetch' + (service ? '?service=' + encodeURIComponent(service) : '');
      const data = await apiCall(url);
      
      if (!data) return;
      
      if (data.error) {
        container.innerHTML = '<p style="color: var(--danger);">' + data.message + '</p>';
        return;
      }
      
      if (!data.codes || data.codes.length === 0) {
        container.innerHTML = '<p style="color: var(--text2);">未找到验证码</p>';
        return;
      }
      
      container.innerHTML = data.codes.map(c => \`
        <div class="code-item">
          <div class="code">\${c.code}</div>
          <div class="meta">\${c.subject || 'N/A'} · \${c.date || 'N/A'}</div>
        </div>
      \`).join('');
    }
    
    // Toast
    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.remove('hidden');
      setTimeout(() => toast.classList.add('hidden'), 3000);
    }
  </script>
</body>
</html>`;
}
