// src/firebase.js  (BACKEND — Admin SDK, ESM-correct imports)
import 'dotenv/config'

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { readFileSync } from 'fs'

let serviceAccount

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production (Vercel): credentials come from an env var (JSON string)
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Local: read from file
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  try {
    serviceAccount = JSON.parse(readFileSync(credPath, 'utf8'))
  } catch (err) {
    throw new Error(
      `Could not read service account file at "${credPath}". ` +
      `Check the path is correct and the file exists. Original error: ${err.message}`
    )
  }
} else {
  throw new Error('No Firebase credentials found (set FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS)')
}

// Guard against re-initializing on hot reload (nodemon).
const app = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(serviceAccount) })

export const auth = getAuth(app)
export const db = getFirestore(app)