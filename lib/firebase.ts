import { getApps, initializeApp } from 'firebase/app'
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

export function getDb() {
  if (!dbPromise) {
    dbPromise = getRuntimeConfig().then((runtime) => {
      if (!isFirebaseConfigValid(runtime.firebase)) return null
      const app = getApps()[0] ?? initializeApp(runtime.firebase)
      return getFirestore(app)
    })
  }
  return dbPromise
}
