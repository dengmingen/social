/**
 * ESA Pages 入口函数（放仓库 dist/ 根下，控制台「函数文件路径」填 ./dist/pages-function.js）
 *
 * 职责只有一件事：把「未命中静态资源」的页面请求原样转给 api 边缘函数，由它决定返回什么——
 *   爬虫 UA   → 注入 title/description/canonical/JSON-LD 的服务端 HTML
 *   普通 UA   → SPA shell（history 深链回退，前端路由自己渲染 404 页）
 *   sitemap   → 动态 /sitemap.xml
 * 静态资源（/assets/*、/index.html、/shell.html、favicon、图片等命中 dist 文件的请求）
 * 由 Pages 直接返回，不进本函数，因此不带任何数据库凭据。
 *
 * 两个必须保持的前提（见 docs/SEO.md）：
 *  1) 不要配置 assets.notFoundStrategy —— 配了之后导航请求不再触发本函数；
 *  2) api 函数的 SHELL_URL 必须指向上面那份静态 shell.html，不能是 / 或 /index.html。
 */

// ESA Pages 项目环境变量通过 process.env 读取；未配置时用生产后端
const API_ORIGIN =
  (typeof process !== 'undefined' && process.env && process.env.SEO_API_ORIGIN) || 'https://api.vasc.beer'
// 只透传这几个头：上游若带 content-encoding/content-length，运行时已解压改长度，原样复制会坏响应
const PASS_HEADERS = ['content-type', 'cache-control', 'vary', 'location', 'x-robots-tag']

export default {
  async fetch(request) {
    const url = new URL(request.url)
    const p = url.pathname
    const headable = request.method === 'GET' || request.method === 'HEAD'
    // 与 api 函数 handlePageRequest 的判定保持一致：无扩展名路径 + sitemap.xml；
    // /api、/_img 等前缀不外送，避免 www 变成 api 的开放代理
    const isPage = headable && (p === '/sitemap.xml' || (!/\.[a-z0-9]+$/i.test(p) && !p.startsWith('/api') && !p.startsWith('/_')))
    if (!isPage) return new Response('Not Found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

    let up
    try {
      up = await fetch(API_ORIGIN + p + url.search, {
        method: request.method,
        headers: { 'User-Agent': request.headers.get('user-agent') || '' },
        redirect: 'manual'
      })
    } catch (e) {
      return new Response('Upstream error', { status: 502, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
    const headers = new Headers()
    for (const k of PASS_HEADERS) {
      const v = up.headers.get(k)
      if (v) headers.set(k, v)
    }
    return new Response(up.body, { status: up.status, headers })
  }
}
