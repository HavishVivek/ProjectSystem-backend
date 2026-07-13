// src/index.js  (BACKEND — Express server entry point)
// This is NOT the Vue router. This boots the Node/Express API that the
// frontend calls via src/api/client.js. Every feature route is protected by
// requireAuth, which verifies the caller's Firebase ID token.

import express from 'express'
import cors from 'cors'
import 'dotenv/config'

import { requireAuth } from './middleware/auth.js'

// Feature routers — each lives in src/routes/
import aiSearchRouter from './routes/aiSearch.js'
import driveRouter from './routes/drive.js'
import scriptsRouter from './routes/scripts.js'
import embedRouter from './routes/embed.js'
// Not built yet — uncomment as you add them:
// import calendarRouter from './routes/calendar.js'
// import notionRouter from './routes/notion.js'

const app = express()

// ── CORS ────────────────────────────────────────────────────────────────────
// Only allow your own frontend origins. This is your responsibility now that
// you're not on Firebase Callable Functions (which handled CORS automatically).
const allowedOrigins = [
  'http://localhost:5173', 
  'http://localhost:5174',                 // Vite dev server
  'https://video-helper-xi.vercel.app'
  // 'https://your-production-domain.com',  // add when you deploy the frontend
]

app.use(cors({
  origin(origin, callback) {
    // allow same-origin / curl / server-to-server (no Origin header)
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true)
    }
    return callback(new Error(`Origin not allowed: ${origin}`))
  },
}))

// ── Body parsing ──────────────────────────────────────────────────────────
// Raise the limit because AI search sends the full folder corpus in the body.
app.use(express.json({ limit: '5mb' }))

// ── Health check (no auth) ──────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }))

// ── Feature routes (all require a valid Firebase ID token) ──────────────────
app.use('/api/ai-search', requireAuth, aiSearchRouter)
app.use('/api/drive', requireAuth, driveRouter)
app.use('/api/scripts', requireAuth, scriptsRouter)
app.use('/api/embed', embedRouter)
// app.use('/api/calendar', requireAuth, calendarRouter)
// app.use('/api/notion', requireAuth, notionRouter)

// ── 404 for unmatched API paths ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` })
})

// ── Central error handler ───────────────────────────────────────────────────
// Express 5 forwards async errors here automatically.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: 'Internal server error' })
})

// ── Start ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080

// Only listen locally; Vercel imports the app as a handler.
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`)
  })
}

export default app