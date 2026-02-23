/**
 * IndexedDB wrapper for image src storage.
 *
 * Private/incognito browsing: IDB is unavailable (or throws SecurityError).
 * In that case every function transparently falls back to an in-memory Map
 * so the app keeps working for the session — images just won't survive a reload
 * (which is exactly what users expect from private browsing).
 */

const DB_NAME = 'tier-maker'
const STORE   = 'images'
const DB_VER  = 1

// In-memory fallback (used when IDB is unavailable)
const _mem = new Map<string, string>()
let _db: IDBDatabase | null = null
let _idbUnavailable = false

function openDb(): Promise<IDBDatabase> {
  if (_idbUnavailable) return Promise.reject(new Error('IDB unavailable'))
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VER)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => { _db = req.result; resolve(_db) }
      req.onerror  = () => reject(req.error)
      req.onblocked = () => reject(new Error('IDB blocked'))
    } catch (e) {
      // indexedDB itself may be undefined in some environments
      reject(e)
    }
  })
}

/** Return all stored images as a Map<id, src>.
 *  Falls back to in-memory store if IDB is unavailable. */
export async function idbGetAll(): Promise<Map<string, string>> {
  try {
    const db = await openDb()
    return await new Promise((resolve, reject) => {
      const map = new Map<string, string>()
      const tx  = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) { map.set(cursor.key as string, cursor.value as string); cursor.continue() }
        else resolve(map)
      }
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    _idbUnavailable = true
    // Return copy of memory store so caller gets what we have
    return new Map(_mem)
  }
}

/** Write multiple [id, src] pairs.
 *  Always updates the memory store; also persists to IDB when available. */
export async function idbPutMany(pairs: Array<[string, string]>): Promise<void> {
  if (pairs.length === 0) return
  // Always update in-memory store (serves as read-through cache and fallback)
  for (const [id, src] of pairs) _mem.set(id, src)

  if (_idbUnavailable) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx    = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      for (const [id, src] of pairs) store.put(src, id)
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  } catch {
    _idbUnavailable = true
    // Memory store already updated above — session continues normally
  }
}

/** Returns true when IDB is open and working (false in private browsing or after a failure). */
export function isIdbAvailable(): boolean { return !_idbUnavailable }

/** Synchronous IDB write — safe to call in beforeunload handlers.
 *  Requires the DB to already be open (_db set); always updates the memory store.
 *  The transaction is fire-and-forget: browsers keep started IDB transactions
 *  alive through page teardown so data is not lost. */
export function idbPutManySync(pairs: Array<[string, string]>): void {
  if (pairs.length === 0) return
  for (const [id, src] of pairs) _mem.set(id, src)
  if (_idbUnavailable || !_db) return
  try {
    const tx    = _db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    for (const [id, src] of pairs) store.put(src, id)
    // No await — the started transaction survives page unload
  } catch { /* ignore */ }
}

/** Delete IDB entries not in keepIds (garbage collect deleted images).
 *  Also prunes the memory store. */
export async function idbCleanup(keepIds: Set<string>): Promise<void> {
  // Prune memory store
  for (const key of _mem.keys()) {
    if (!keepIds.has(key)) _mem.delete(key)
  }

  if (_idbUnavailable) return
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (cursor) {
          if (!keepIds.has(cursor.key as string)) cursor.delete()
          cursor.continue()
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror    = () => reject(tx.error)
    })
  } catch {
    _idbUnavailable = true
  }
}
