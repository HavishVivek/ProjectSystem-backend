// src/routes/drive.js  (BACKEND)
// Receives the file refs the user picked plus their short-lived Drive access
// token, enriches them via the Drive API, and persists them to Firestore under
// the authenticated user's folder.
//
// Why this is on the backend:
// - the Firestore write is a trusted operation tied to req.user.uid
// - any elevated Drive API work (metadata, content, copying) stays off the client
//
// req.user is populated by the requireAuth middleware (Firebase ID token).
// driveAccessToken is the user's OWN Google OAuth token from the Picker flow —
// it is NOT the Firebase token. We use it only for this request, never store it.

import { Router } from 'express'
import { db } from '../firebase.js'

const router = Router()

router.post('/store', async (req, res) => {
  const { folderId, files, driveAccessToken } = req.body
  const uid = req.user.uid

  if (!folderId || typeof folderId !== 'string') {
    return res.status(400).json({ error: 'Missing folderId' })
  }
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ error: 'No files provided' })
  }
  if (!driveAccessToken) {
    return res.status(400).json({ error: 'Missing Drive access token' })
  }

  try {
    // Optionally enrich each file with fresh metadata from the Drive API.
    // This verifies the user actually has access and gets canonical values.
    const enriched = await Promise.all(
      files.map(async (f) => {
        try {
          const metaRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${f.id}` +
              `?fields=id,name,mimeType,iconLink,webViewLink,size,modifiedTime`,
            { headers: { Authorization: `Bearer ${driveAccessToken}` } }
          )

          if (!metaRes.ok) {
            // Fall back to the values the Picker already gave us.
            return { ...f, _enriched: false }
          }

          const meta = await metaRes.json()
          return {
            id: meta.id,
            name: meta.name,
            mimeType: meta.mimeType,
            url: meta.webViewLink || f.url,
            iconUrl: meta.iconLink || f.iconUrl,
            size: meta.size ?? null,
            modifiedTime: meta.modifiedTime ?? null,
            _enriched: true,
          }
        } catch {
          return { ...f, _enriched: false }
        }
      })
    )

    // Persist to Firestore. Adjust the collection path to your schema.
    // Here: users/{uid}/folders/{folderId}/driveItems/{auto-id}
    const batch = db.batch()
    const colRef = db
      .collection('users').doc(uid)
      .collection('folders').doc(folderId)
      .collection('driveItems')

    const stored = enriched.map((item) => {
      const docRef = colRef.doc()           // auto-id
      const record = {
        ...item,
        source: 'google-drive',
        addedAt: new Date().toISOString(),
      }
      batch.set(docRef, record)
      return { docId: docRef.id, ...record }
    })

    await batch.commit()

    res.json({ items: stored })
  } catch (err) {
    console.error('drive/store error:', err)
    res.status(500).json({ error: 'Failed to store Drive items' })
  }
})

export default router