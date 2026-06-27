// src/routes/scripts.js  (BACKEND)
// Houses every Groq call that used to live in the frontend scriptsStore.
// The Groq API key lives only here, in process.env.GROQ_API_KEY.
//
// Two patterns are shown:
//   1. Non-streaming (generate-intros, feedback, prediction, variations) —
//      call Groq, return JSON. Same shape as the AI-search route.
//   2. Streaming (generate-script-streaming) — pipe Groq's token stream
//      straight through to the browser so the live-typing UI keeps working.
//
// req.user.uid is available (requireAuth middleware) if you want per-user logging.
//
// IMPORTANT: the prompt text, model names, temperatures, and any JSON parsing
// inside each handler must be copied from your existing scriptsStore methods.
// They're marked `// FROM YOUR STORE:` below. The transport is done; the
// prompt content is the only thing you need to paste in.

import { Router } from 'express'

const router = Router()

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

// ── Shared helper for non-streaming Groq calls ──────────────────────────────
async function callGroq({ model, messages, temperature = 0.7, max_tokens = 2000, response_format }) {
  const body = { model, messages, temperature, max_tokens }
  if (response_format) body.response_format = response_format

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.error?.message || `Groq HTTP ${res.status}`)
  }

  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. NON-STREAMING ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/scripts/intros   { topic, notes }
router.post('/intros', async (req, res) => {
  const { topic, notes } = req.body
  if (!topic) return res.status(400).json({ error: 'Missing topic' })

  try {
    // FROM YOUR STORE: paste the model + messages your generateIntros used.
    const content = await callGroq({
      model: 'llama-3.3-70b-versatile',           // FROM YOUR STORE
      temperature: 0.8,                            // FROM YOUR STORE
      messages: [
        { role: 'system', content: '/* FROM YOUR STORE: intros system prompt */' },
        { role: 'user', content: `Topic: ${topic}\nNotes: ${notes || ''}` },
      ],
    })
    res.json({ result: content })
  } catch (e) {
    console.error('intros error:', e)
    res.status(502).json({ error: e.message })
  }
})

// POST /api/scripts/script   { topic, selectedIntro }
router.post('/script', async (req, res) => {
  const { topic, selectedIntro } = req.body
  if (!topic) return res.status(400).json({ error: 'Missing topic' })

  try {
    const content = await callGroq({
      model: 'llama-3.3-70b-versatile',           // FROM YOUR STORE
      messages: [
        { role: 'system', content: '/* FROM YOUR STORE: script system prompt */' },
        { role: 'user', content: `Topic: ${topic}\nIntro: ${selectedIntro}` },
      ],
    })
    res.json({ result: content })
  } catch (e) {
    console.error('script error:', e)
    res.status(502).json({ error: e.message })
  }
})

// POST /api/scripts/variations   { topic, selectedIntro }
router.post('/variations', async (req, res) => {
  const { topic, selectedIntro } = req.body
  if (!topic) return res.status(400).json({ error: 'Missing topic' })

  try {
    const content = await callGroq({
      model: 'llama-3.3-70b-versatile',           // FROM YOUR STORE
      messages: [
        { role: 'system', content: '/* FROM YOUR STORE: variations system prompt */' },
        { role: 'user', content: `Topic: ${topic}\nIntro: ${selectedIntro}` },
      ],
    })
    res.json({ result: content })
  } catch (e) {
    console.error('variations error:', e)
    res.status(502).json({ error: e.message })
  }
})

// POST /api/scripts/feedback   { content, sectionType }
router.post('/feedback', async (req, res) => {
  const { content, sectionType } = req.body
  if (!content) return res.status(400).json({ error: 'Missing content' })

  try {
    const result = await callGroq({
      model: 'llama-3.3-70b-versatile',           // FROM YOUR STORE
      messages: [
        { role: 'system', content: '/* FROM YOUR STORE: feedback system prompt */' },
        { role: 'user', content: `Section: ${sectionType}\n\n${content}` },
      ],
    })
    res.json({ result })
  } catch (e) {
    console.error('feedback error:', e)
    res.status(502).json({ error: e.message })
  }
})

// POST /api/scripts/prediction   { content }
router.post('/prediction', async (req, res) => {
  const { content } = req.body
  if (!content) return res.status(400).json({ error: 'Missing content' })

  try {
    const result = await callGroq({
      model: 'llama-3.3-70b-versatile',           // FROM YOUR STORE
      messages: [
        { role: 'system', content: '/* FROM YOUR STORE: prediction system prompt */' },
        { role: 'user', content },
      ],
    })
    res.json({ result })
  } catch (e) {
    console.error('prediction error:', e)
    res.status(502).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. STREAMING ROUTE
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/scripts/script-stream   { topic, selectedIntro }
// Streams plain text chunks to the client as they arrive from Groq.
// The frontend reads this with a streaming fetch (see store rewrite).

router.post('/script-stream', async (req, res) => {
  const { topic, selectedIntro } = req.body
  if (!topic) return res.status(400).json({ error: 'Missing topic' })

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',          // FROM YOUR STORE
        stream: true,                              // <- the key difference
        messages: [
          { role: 'system', content: '/* FROM YOUR STORE: script system prompt */' },
          { role: 'user', content: `Topic: ${topic}\nIntro: ${selectedIntro}` },
        ],
      }),
    })

    if (!groqRes.ok || !groqRes.body) {
      const err = await groqRes.json().catch(() => ({}))
      return res.status(502).json({ error: err?.error?.message || 'Groq stream failed' })
    }

    // Tell the client this is a plain-text stream we'll flush incrementally.
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')

    // Groq streams Server-Sent-Events lines like:  data: {"choices":[{"delta":{"content":"..."}}]}
    // We parse out the token deltas and write only the text to our response.
    const reader = groqRes.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''   // keep the last partial line

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (payload === '[DONE]') continue

        try {
          const json = JSON.parse(payload)
          const token = json.choices?.[0]?.delta?.content
          if (token) res.write(token)   // flush this token to the browser
        } catch {
          // ignore keep-alive / non-JSON lines
        }
      }
    }

    res.end()
  } catch (e) {
    console.error('script-stream error:', e)
    // If headers already sent (streaming started), just end; else send JSON error.
    if (res.headersSent) res.end()
    else res.status(500).json({ error: e.message })
  }
})

export default router