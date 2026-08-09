// 和风天气缓存代理 - 服务端共享内存缓存
// 依赖:Node.js 12+ (使用原生 https 模块,无需额外依赖)
// 挂载方式:在 index.js 的 app.listen 之前加 app.use(require('./qweather-proxy'))

const express = require('express')
const https = require('https')
const router = express.Router()

// ============ 和风配置 ============
const QWEATHER_HOST = 'ne6yw37jqh.re.qweatherapi.com'
const QWEATHER_KEY = process.env.QWEATHER_KEY || '0d4266f31e754e56bba56a54ccf6ee59'

// ============ 内存缓存 ============
const cache = new Map()
const MAX_CACHE_SIZE = 200

// 接口白名单(防止代理被滥用)
const ALLOWED_PATHS = new Set([
  '/v7/tropical/storm-list',
  '/v7/tropical/storm-track',
  '/v7/tropical/storm-forecast',
  '/v7/weather/now',
  '/v7/weather/24h',
  '/v7/minutely/5m'
])

// 按和风官方推荐缓存时间设置弹性 TTL
// 文档: https://dev.qweather.com/docs/best-practices/cache/
function getCacheTtl(path) {
  if (path.includes('/tropical/storm')) return 20 * 60 * 1000   // 台风活跃期 20min
  if (path.includes('/weather/now')) return 10 * 60 * 1000       // 实时天气 10min
  if (path.includes('/minutely/')) return 5 * 60 * 1000          // 分钟降水 5min
  if (path.includes('/weather/24h')) return 30 * 60 * 1000       // 逐小时 30min
  return 10 * 60 * 1000
}

function buildCacheKey(path, params) {
  const keys = Object.keys(params).filter(k => k !== 'key').sort()
  const qs = keys.map(k => `${k}=${params[k]}`).join('&')
  return `${path}|${qs}`
}

function pruneCache() {
  if (cache.size <= MAX_CACHE_SIZE) return
  const entries = [...cache.entries()].sort((a, b) => a[1].cachedAt - b[1].cachedAt)
  const removeCount = cache.size - MAX_CACHE_SIZE
  for (let i = 0; i < removeCount; i++) cache.delete(entries[i][0])
}

// 用原生 https 模块发起 GET 请求(Node 12+ 兼容,无需额外依赖)
function httpsGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error('JSON parse failed: ' + e.message))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'))
    })
  })
}

// ============ 代理接口 ============
router.get('/api/qweather', async (req, res) => {
  const path = req.query.path
  if (!path || !ALLOWED_PATHS.has(path)) {
    return res.status(400).json({ code: '400', message: 'path not allowed' })
  }

  const params = {}
  for (const k of Object.keys(req.query)) {
    if (k !== 'path' && k !== 'refresh') params[k] = req.query[k]
  }

  const forceRefresh = req.query.refresh === '1'
  const cacheKey = buildCacheKey(path, params)

  // 命中且未过期,直接返回
  if (!forceRefresh && cache.has(cacheKey)) {
    const entry = cache.get(cacheKey)
    if (Date.now() - entry.cachedAt < getCacheTtl(path)) {
      return res.json(entry.data)
    }
    cache.delete(cacheKey)
  }

  // 未命中,请求和风
  const query = Object.keys(params)
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
    .join('&')
  const url = `https://${QWEATHER_HOST}${path}?key=${QWEATHER_KEY}&${query}`

  try {
    const data = await httpsGet(url, 8000)
    if (data && String(data.code) === '200') {
      cache.set(cacheKey, { data, cachedAt: Date.now() })
      pruneCache()
    }
    return res.json(data)
  } catch (err) {
    console.error('[qweather-proxy] 上游请求失败:', err && err.message)
    if (cache.has(cacheKey)) {
      console.warn('[qweather-proxy] 使用过期缓存兜底:', cacheKey)
      return res.json(cache.get(cacheKey).data)
    }
    return res.status(502).json({ code: '502', message: 'qweather upstream error' })
  }
})

// 清除缓存接口(和风文档要求)
router.post('/api/qweather/clear', (req, res) => {
  cache.clear()
  res.json({ ok: true, cleared: true, size: 0 })
})

// 健康检查
router.get('/api/qweather/status', (req, res) => {
  res.json({ ok: true, cacheSize: cache.size, maxCacheSize: MAX_CACHE_SIZE })
})

module.exports = router
