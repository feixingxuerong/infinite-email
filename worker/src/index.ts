// Infinite Email - Alias Management API v1
// Uses D1 for storage (aliases, rules, audit)

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // Health check
    if (path === '/health') {
      return new Response('ok')
    }

    // Auth check for API endpoints
    const token = request.headers.get('X-Admin-Token')
    if (!token || token !== env.ADMIN_TOKEN) {
      if (path.startsWith('/api/')) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    // API Routes
    try {
      // GET /api/aliases - List all aliases
      if (path === '/api/aliases' && method === 'GET') {
        const stmt = env.DB.prepare(`
          SELECT alias, status, created_at, note 
          FROM aliases 
          ORDER BY created_at DESC
          LIMIT 100
        `)
        const results = await stmt.all()
        
        // Log audit
        await logAudit(env, null, 'list_aliases', request)
        
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

      // GET /api/audit - List audit logs (bonus)
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
