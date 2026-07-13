// routes/embed.js  (videohelper-backend)
// Tiered website embedding:
//   Tier 1  GET /api/embed/check?url=...   → decides iframe | proxy | screenshot
//   Tier 2  GET /api/embed/render?url=...  → serves the page from our origin
//                                            with frame-blocking stripped
// Register in your server entry:
//   import embedRouter from './routes/embed.js'
//   app.use('/api/embed', embedRouter)

import { Router } from 'express'

const router = Router()

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'

const FETCH_TIMEOUT_MS = 8000
const MAX_HTML_BYTES = 3 * 1024 * 1024 // 3MB cap for proxied pages

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

// Basic SSRF guard — reject non-http(s) and private/loopback hosts.
function validateUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null

  const h = u.hostname.toLowerCase()
  const isPrivate =
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.endsWith('.internal') ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)

  return isPrivate ? null : u
}

// True if response headers forbid embedding on a foreign origin.
function isFrameBlocked(headers) {
  const xfo = (headers.get('x-frame-options') || '').toUpperCase()
  if (xfo.includes('DENY') || xfo.includes('SAMEORIGIN')) return true

  const csp = headers.get('content-security-policy') || ''
  const match = csp.match(/frame-ancestors\s+([^;]+)/i)
  if (match) {
    // Any frame-ancestors directive that isn't a wildcard blocks us.
    if (!match[1].toLowerCase().includes('*')) return true
  }
  return false
}

async function fetchPage(url) {
  return fetch(url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': UA,
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return null
  return m[1].replace(/\s+/g, ' ').trim().slice(0, 140) || null
}

/* ---------------------------------------------------------------- */
/* Tier 1 — check                                                    */
/* ---------------------------------------------------------------- */

router.get('/check', async (req, res) => {
  const u = validateUrl(req.query.url)
  if (!u) return res.status(400).json({ error: 'Invalid URL' })

  try {
    const resp = await fetchPage(u.href)
    const contentType = (resp.headers.get('content-type') || '').toLowerCase()
    const isHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml')

    // Non-HTML (images, PDFs, video) — direct iframe almost always works.
    if (!isHtml) {
      return res.json({
        tier: 'iframe',
        finalUrl: resp.url,
        title: null,
        contentType,
      })
    }

    const blocked = isFrameBlocked(resp.headers)

    // Read a slice of the body for the <title> without pulling huge pages.
    let title = null
    try {
      const html = await resp.text()
      title = extractTitle(html)
    } catch {
      /* title is optional */
    }

    if (!resp.ok && resp.status >= 400) {
      // Site answered but refused us (403 bot-wall etc.) → screenshot floor.
      return res.json({ tier: 'screenshot', finalUrl: u.href, title })
    }

    return res.json({
      tier: blocked ? 'proxy' : 'iframe',
      finalUrl: resp.url,
      title,
    })
  } catch {
    // Network failure / timeout — the screenshot service may still succeed
    // because it renders from its own infrastructure.
    return res.json({ tier: 'screenshot', finalUrl: u.href, title: null })
  }
})

/* ---------------------------------------------------------------- */
/* Tier 2 — proxy render                                             */
/* ---------------------------------------------------------------- */

router.get('/render', async (req, res) => {
  const u = validateUrl(req.query.url)
  if (!u) return res.status(400).send('Invalid URL')

  try {
    const resp = await fetchPage(u.href)
    const contentType = (resp.headers.get('content-type') || '').toLowerCase()

    // Only HTML gets rewritten; anything else just redirects to the source
    // (the browser can iframe images/PDFs directly).
    if (!contentType.includes('text/html')) {
      return res.redirect(302, u.href)
    }

    let html = await resp.text()
    if (html.length > MAX_HTML_BYTES) html = html.slice(0, MAX_HTML_BYTES)

    // Strip <meta http-equiv="Content-Security-Policy"> so injected assets load.
    html = html.replace(
      /<meta[^>]+http-equiv=["']?content-security-policy["']?[^>]*>/gi,
      ''
    )

    // <base> makes relative assets resolve against the real site,
    // and the click interceptor keeps in-page navigation inside the proxy.
    const finalUrl = resp.url
    const inject =
      `<base href="${finalUrl.replace(/"/g, '&quot;')}">` +
      `<script>(function(){` +
      `document.addEventListener('click',function(e){` +
      `var a=e.target&&e.target.closest?e.target.closest('a'):null;` +
      `if(!a||!a.getAttribute('href'))return;` +
      `e.preventDefault();` +
      `try{var abs=new URL(a.getAttribute('href'),document.baseURI).href;` +
      `window.location.href='/api/embed/render?url='+encodeURIComponent(abs);}` +
      `catch(err){}` +
      `},true);` +
      `})();<\/script>`

    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1>${inject}`)
    } else {
      html = inject + html
    }

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, max-age=300',
      // Our response carries no X-Frame-Options / CSP, so it embeds freely.
    })
    return res.send(html)
  } catch {
    // Proxy failed → tell the client to fall to the screenshot tier.
    return res.status(502).send('Proxy render failed')
  }
})

export default router