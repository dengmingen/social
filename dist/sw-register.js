// PWA Service Worker 注册（外链文件：生产 CSP script-src 'self' 禁内联脚本）
if ('serviceWorker' in navigator && !window.Capacitor && !/localhost|127\.0\.0\.1/.test(location.hostname)) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {})
  })
}
