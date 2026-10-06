// Avance de cada persona (HV, soportes) guardado en este navegador bajo un id de registro.
// Así una recarga no borra lo hecho y la constancia queda ligada al mismo registro.
const SESSION_KEY = 'sanithelp-session-id'
const DATABASE_NAME = 'sanithelp-progress'
const STORE_NAME = 'drafts'

export function getSessionId() {
  try {
    const current = localStorage.getItem(SESSION_KEY)
    if (current) return current
    const created = crypto.randomUUID()
    localStorage.setItem(SESSION_KEY, created)
    return created
  } catch {
    return crypto.randomUUID()
  }
}

export function startNewSession() {
  const created = crypto.randomUUID()
  try {
    localStorage.setItem(SESSION_KEY, created)
  } catch {
    // Sin almacenamiento el registro solo vive en esta pestaña.
  }
  return created
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'sessionId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runTransaction(mode, action) {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode)
    const request = action(transaction.objectStore(STORE_NAME))
    transaction.oncomplete = () => {
      database.close()
      resolve(request?.result)
    }
    transaction.onerror = () => {
      database.close()
      reject(transaction.error)
    }
  })
}

export async function readDraft(sessionId) {
  return (await runTransaction('readonly', (store) => store.get(sessionId))) || null
}

export function writeDraft(sessionId, draft) {
  return runTransaction('readwrite', (store) => store.put({ ...draft, sessionId }))
}

export function deleteDraft(sessionId) {
  return runTransaction('readwrite', (store) => store.delete(sessionId))
}
