/* Vasc 社区 Service Worker（批次4 PWA）
 * 策略：
 *  - /api/、/_img/、/_file/ 一律直连网络（API 有自己的边缘缓存与鉴权，SW 不插手）
 *  - /assets/*（构建产物，文件名含 hash）→ 缓存优先，命中零网络
 *  - 页面导航 → 网络优先，失败回退缓存的 SPA 壳（弱网/断网不白屏）
 *  - 静态壳 '/' 预缓存
 * 版本号变更即整池作废（老缓存全清）
 */
const VERSION = 'v1'
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
  )
})
