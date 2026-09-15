/** host webserver 路由适配器 */
import { URL } from 'node:url'

/** host webserver 以位置参数 (req, res) 调 handler —— 做一层适配：
 *  loopback 校验 + 方法白名单 + JSON body 解析，再以 {req,res,url,body} 调业务 handler */
export function createRouteAdapter(ctx) {
  return (spec) => ({
    kind: 'exact',
    path: spec.path,
    handler: async (req, res) => {
      const addr = req?.socket?.remoteAddress
      if (addr !== '127.0.0.1' && addr !== '::1' && addr !== '::ffff:127.0.0.1') {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { message: 'forbidden: loopback-only' } }))
        return
      }
      if (!spec.methods.includes(req.method)) {
        res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: { message: 'method not allowed' } }))
        return
      }
      const url = new URL(req.url ?? '/', 'http://localhost')
      let body = {}
      if (spec.jsonBody === true && req.method === 'POST') {
        let raw = ''
        for await (const chunk of req) raw += chunk
        try { body = JSON.parse(raw) } catch {
          res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: { message: 'invalid JSON body' } }))
          return
        }
      }
      try { await spec.handler({ req, res, url, body }) } catch (e) {
        ctx.logger.warn(`[enterprise] handler error: ${e?.message ?? e}`)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: { message: String(e?.message ?? e).slice(0, 160) } }))
        }
      }
    },
  })
}
