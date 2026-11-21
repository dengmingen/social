/* Vasc 社区 Service Worker（批次4 PWA）
 * 策略：
 *  - /api/、/_img/、/_file/ 一律直连网络（API 有自己的边缘缓存与鉴权，SW 不插手）
 *  - /assets/*（构建产物，文件名含 hash）→ 缓存优先，命中零网络
 *  - 页面导航 → 网络优先，失败回退缓存的 SPA 壳（弱网/断网不白屏）
 *  - 静态壳 '/' 预缓存
 * 版本号变更即整池作废（老缓存全清）
 */
const VERSION = 'v3'
const SHELL_CACHE = `vasc-shell-${VERSION}`
const ASSET_CACHE = `vasc-assets-${VERSION}`
const IMG_CACHE = `vasc-img-${VERSION}`
const IMG_CACHE_MAX = 120

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(['/']).then(() => self.skipWaiting()))
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

/** 图片缓存 LRU 简化实现：超量即删最早条目 */
async function putImgCache(request, response) {
  const cache = await caches.open(IMG_CACHE)
  const keys = await cache.keys()
  if (keys.length >= IMG_CACHE_MAX) {
    await cache.delete(keys[0])
  }
  await cache.put(request, response)
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  // API 与资源代理一律直连（不做任何缓存干预）
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_img/') || url.pathname.startsWith('/_file/')) return
  // M-fix：跳过开发态资源（vite dev 的模块/HMR 请求绝不能被 SW 拦截，否则整站 ERR_FAILED）
  if (url.pathname.startsWith('/src/') || url.pathname.startsWith('/@vite/') || url.pathname.startsWith('/@id/') ||
      url.pathname.startsWith('/node_modules/') || url.search.includes('t=')) return

  // 页面导航：网络优先，失败回退 SPA 壳
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put('/', copy)).catch(() => {})
          return res
        })
        .catch(() => caches.match('/').then((hit) => hit || Response.error()))
    )
    return
  }

  // 构建产物：缓存优先（文件名含 hash，命中即不可变）
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone()
        caches.open(ASSET_CACHE).then((c) => c.put(req, copy)).catch(() => {})
        return res
      }))
        // M-fix：网络失败兜底为 504 —— 不再让 respondWith 整体 reject
        // （net::ERR_FAILED + 无穷未捕获异常刷屏的根因）；负响应不写缓存，恢复后自动取新
        .catch(() => new Response(null, { status: 504, statusText: 'SW Network Timeout' }))
    )
    return
  }

  // 其它同源静态（图标/manifest 等）：缓存优先 + 图片池上限
  event.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith('/icons/') || /\.(png|jpe?g|svg|webp|gif)$/i.test(url.pathname))) {
        event.waitUntil(putImgCache(req, res.clone()))
      }
      return res
    }))
      .catch(() => new Response(null, { status: 504, statusText: 'SW Network Timeout' }))
  )
})

/* ---------------- Web Push（批次8 通知触达） ----------------
 * 载荷由后端 RFC8291 加密：{ title, body, url, tag, type }。
 * 系统级通知（App 关闭/后台也能收到）；点击聚焦已有窗口或新开落地页。
 */
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const title = data.title || 'Vasc 社区'
  const options = {
    body: data.body || '',
    icon: '/icons/app-icon-192.png',
    badge: '/icons/favicon-32.png',
    tag: data.tag || 'vasc-notify',
    renotify: true,
    data: { url: data.url || '/' }
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // 已有同源窗口 → 聚焦并导航；否则新开
      for (const client of clients) {
        if ('focus' in client) {
          client.focus()
          if ('navigate' in client) client.navigate(target).catch(() => {})
          return
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
