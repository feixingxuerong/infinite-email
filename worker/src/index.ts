export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext) {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return new Response('ok')
    }

    // Minimal placeholder API (to be expanded)
    if (url.pathname === '/api/aliases' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const prefix = (body.prefix || 'alias').toString().slice(0, 32)
      const ts = new Date().toISOString().slice(0, 10).replace(/-/g, '')
      const alias = `${prefix}-${ts}-${crypto.randomUUID().slice(0, 8)}`

      return Response.json({
        alias,
        address: env.DOMAIN ? `${alias}@${env.DOMAIN}` : alias,
        note: 'created (placeholder; persistence TBD)'
      })
    }

    return new Response('Not found', { status: 404 })
  },
}
