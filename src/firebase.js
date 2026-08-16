import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getAI, GoogleAIBackend } from 'firebase/ai'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

/** False until real config lands in .env.local — lets the UI show a setup banner instead of crashing on placeholder keys. */
export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId)

export const app = initializeApp(
  isFirebaseConfigured ? firebaseConfig : { ...firebaseConfig, apiKey: 'demo-key', projectId: 'demo-project' },
)
export const auth = getAuth(app)
export const db = getFirestore(app)

/**
 * Gemini via the free Gemini Developer API tier (GoogleAIBackend), not the paid
 * Vertex AI backend — client-side calls, no separate server or exposed API key.
 * Needs "Build > AI Logic" enabled once in the Firebase console; null (and the
 * app falls back to local parsing) until then or without a config at all.
 */
export const ai = isFirebaseConfigured ? getAI(app, { backend: new GoogleAIBackend() }) : null
