import { getApps, initializeApp } from 'firebase/app'
import { getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

export type RuntimeConfig = {
  firebase: {
    apiKey: string
    authDomain: string
    projectId: string
    storageBucket: string
    messagingSenderId: string
    appId: string
  }
  teamsMeetingChatUrl: string
}

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null
let dbPromise: Promise<Firestore | null> | null = null
let authPromise: Promise<Auth | null> | null = null

export function getRuntimeConfig() {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = fetch('/api/runtime-config', { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('RUNTIME_CONFIG_FETCH_FAILED')
        return response.json() as Promise<RuntimeConfig>
      })
  }
  return runtimeConfigPromise
}

export function isFirebaseConfigValid(config: RuntimeConfig['firebase']) {
  return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId)
}

async function getFirebaseApp() {
  const runtime = await getRuntimeConfig()
  if (!isFirebaseConfigValid(runtime.firebase)) return null
  return getApps()[0] ?? initializeApp(runtime.firebase)
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = getFirebaseApp().then((app) => app ? getFirestore(app) : null)
  }
  return dbPromise
}

export function getFirebaseAuth() {
  if (!authPromise) {
    authPromise = getFirebaseApp().then((app) => app ? getAuth(app) : null)
  }
  return authPromise
}

export async function ensureSignedIn() {
  const auth = await getFirebaseAuth()
  if (!auth) return false
  if (auth.currentUser) return true
  try {
    await signInAnonymously(auth)
    return true
  } catch (error) {
    console.error('Firebase anonymous sign-in failed', error)
    return false
  }
}
