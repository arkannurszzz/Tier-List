import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { idbGetAll, idbPutMany, idbPutManySync, idbCleanup, isIdbAvailable } from '@/lib/imageDb'

export interface TierImage {
  id: string
  src: string
  name?: string
}

export interface TierConfig {
  id: string
  label: string
  color: string
  items: TierImage[]
}

// ─── localStorage: structure only (NO src — stays tiny forever) ────────────

const STORAGE_KEY = 'tier-maker-v2'

// Slim types written to localStorage
interface SlimImage { id: string; name?: string }
interface SlimTier  { id: string; label: string; color: string; items: SlimImage[] }
interface SlimState { v: 2; tiers: SlimTier[]; pool: SlimImage[] }

// Old format (v1): had src embedded — used for one-time migration
interface LegacyState {
  tiers: Array<{ id: string; label: string; color: string; items: Array<{ id: string; src?: string; name?: string }> }>
  pool: Array<{ id: string; src?: string; name?: string }>
}

function readLocalStorage(): SlimState | LegacyState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem('tier-maker-state')
    if (!raw) return null
    return JSON.parse(raw) as SlimState | LegacyState
  } catch { return null }
}

function isSlimState(s: SlimState | LegacyState): s is SlimState {
  return (s as SlimState).v === 2
}

function saveStructure(tiers: TierConfig[], pool: TierImage[]) {
  const slim: SlimState = {
    v: 2,
    tiers: tiers.map(t => ({
      id:    t.id,
      label: t.label,
      color: t.color,
      items: t.items.map(i => ({ id: i.id, name: i.name })),
    })),
    pool: pool.map(i => ({ id: i.id, name: i.name })),
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(slim)) } catch { /* ignore */ }
}

// ─── Security helpers ───────────────────────────────────────────────────────

/** Only allow JPEG/PNG/GIF/WebP data URLs. Blocks SVG (can embed scripts/CSS)
 *  and javascript: URIs from malicious peers in collaboration sessions. */
function isSafeSrc(src: string): boolean {
  if (!src) return true // empty = placeholder, always safe
  return /^data:image\/(jpeg|png|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(src)
}

/** Reject color values that are not 6-digit hex to prevent CSS injection. */
function isSafeColor(color: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(color)
}

// ─── Reactive storage-full warning (kept for compatibility) ──────────────

export const storageFullWarning = ref(false)

// ─── Tier defaults ─────────────────────────────────────────────────────────

const TIER_COLORS = [
  '#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f',
  '#bfff7f', '#7fbfff', '#bf7fff', '#ff7fbf',
]

const DEFAULT_TIERS: Omit<TierConfig, 'id'>[] = [
  { label: 'S', color: '#ff7f7f', items: [] },
  { label: 'A', color: '#ffbf7f', items: [] },
  { label: 'B', color: '#ffdf7f', items: [] },
  { label: 'C', color: '#ffff7f', items: [] },
  { label: 'D', color: '#bfff7f', items: [] },
  { label: 'F', color: '#7fbfff', items: [] },
]

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ─── Store ─────────────────────────────────────────────────────────────────

export const useTierStore = defineStore('tier', () => {

  // ── Initialize from localStorage structure (no src yet) ──────────────────
  const saved = readLocalStorage()

  function buildTiers(raw: LegacyState | SlimState | null): TierConfig[] {
    if (!raw) return DEFAULT_TIERS.map(t => ({ ...t, id: generateId() }))
    return raw.tiers.map(t => ({
      id:    t.id,
      label: t.label,
      color: t.color,
      items: t.items.map(i => ({ id: i.id, src: '', name: i.name })),
    }))
  }

  function buildPool(raw: LegacyState | SlimState | null): TierImage[] {
    if (!raw) return []
    return raw.pool.map(i => ({ id: i.id, src: '', name: i.name }))
  }

  const tiers = ref<TierConfig[]>(buildTiers(saved))
  const pool  = ref<TierImage[]>(buildPool(saved))
  const draggingItem = ref<{ source: 'pool' | string; imageId: string } | null>(null)

  // ── IndexedDB sync helpers ────────────────────────────────────────────────

  let idbTimer: ReturnType<typeof setTimeout> | null = null
  let hydrating = false
  // Remote state that arrived while IDB was still loading — applied after hydration.
  let pendingRemoteState: { tiers: TierConfig[], pool: TierImage[] } | null = null

  // Track which image IDs are already persisted in IDB so we only write NEW images.
  // Without this, every state change (e.g. moving one item) would rewrite ALL images —
  // O(n) writes that make adding more images progressively slower and eventually fail.
  const _persistedIds = new Set<string>()

  function flushIdbSync() {
    if (idbTimer) { clearTimeout(idbTimer); idbTimer = null }
    const all = collectAllImages()
    const toWrite = all.filter(img => img.src && !_persistedIds.has(img.id))
    // Use synchronous transaction so data is committed before page tears down
    if (toWrite.length > 0) idbPutManySync(toWrite.map(img => [img.id, img.src]))
  }

  function scheduleIdbSync() {
    if (idbTimer) clearTimeout(idbTimer)
    idbTimer = setTimeout(() => {
      idbTimer = null
      const all = collectAllImages()
      const toWrite = all.filter(img => img.src && !_persistedIds.has(img.id))
      if (toWrite.length === 0) return
      // idbCleanup intentionally removed: cleanup runs only at startup (initFromIdb)
      idbPutMany(toWrite.map(img => [img.id, img.src]))
        .then(() => {
          // Only mark as persisted if IDB is actually available
          if (isIdbAvailable()) {
            for (const img of toWrite) _persistedIds.add(img.id)
          }
        })
        .catch(() => {})
    }, 150)
  }

  function collectAllImages(): TierImage[] {
    return [...pool.value, ...tiers.value.flatMap(t => t.items)]
  }

  // Flush pending IDB write immediately when user closes the tab.
  // IDB transactions that have already started survive page unload in all major browsers.
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushIdbSync)
  }

  // ── Async startup: migrate legacy data + hydrate src from IDB ─────────────
  async function initFromIdb() {
    // Set hydrating=true BEFORE the first await so that any applyRemoteState
    // calls arriving while IDB is loading are queued in pendingRemoteState
    // (not applied with an empty localSrcMap). This closes the race window
    // between page load and idbGetAll() returning.
    hydrating = true
    try {
      const imageMap = await idbGetAll()

      // One-time migration: old localStorage had src embedded → move to IDB
      if (saved && !isSlimState(saved)) {
        const toMigrate: Array<[string, string]> = []
        const legacy = saved as LegacyState
        for (const t of legacy.tiers) {
          for (const i of t.items) {
            if (i.src && !imageMap.has(i.id)) {
              toMigrate.push([i.id, i.src])
              imageMap.set(i.id, i.src)
            }
          }
        }
        for (const i of legacy.pool) {
          if (i.src && !imageMap.has(i.id)) {
            toMigrate.push([i.id, i.src])
            imageMap.set(i.id, i.src)
          }
        }
        if (toMigrate.length > 0) await idbPutMany(toMigrate)
        saveStructure(tiers.value, pool.value)
        try { localStorage.removeItem('tier-maker-state') } catch { /* ignore */ }
      }

      if (imageMap.size === 0) {
        hydrating = false
        return
      }

      // hydrating is already true (set above)
      const usedIds = new Set<string>()

      for (const tier of tiers.value) {
        for (const item of tier.items) {
          const src = imageMap.get(item.id)
          if (src) { item.src = src; usedIds.add(item.id) }
        }
      }
      for (const item of pool.value) {
        const src = imageMap.get(item.id)
        if (src) { item.src = src; usedIds.add(item.id) }
      }

      // Recover orphaned IDB images (e.g. when localStorage was cleared).
      // Rather than letting them get garbage-collected, put them back in the pool
      // so the user's images are never silently lost.
      for (const [id, src] of imageMap) {
        if (!usedIds.has(id)) pool.value.push({ id, src })
      }

      // All images from IDB are already persisted — no need to rewrite them.
      for (const id of imageMap.keys()) _persistedIds.add(id)

      hydrating = false

      // Clean up IDB based on OUR state (after orphan recovery, before peer state).
      // keepIds includes every image we know about, so we only delete truly orphaned
      // entries. Running this before applyRemoteState prevents peer state from
      // accidentally causing cleanup of images we still have locally.
      idbCleanup(new Set(collectAllImages().map(img => img.id))).catch(() => {})

      // Apply any remote collaboration state that arrived while we were loading.
      // This handles the race where a peer broadcasts before our IDB read finishes.
      // Now localSrcMap inside applyRemoteState will have all hydrated src values.
      if (pendingRemoteState) {
        const { tiers: pt, pool: pp } = pendingRemoteState
        pendingRemoteState = null
        applyRemoteState(pt, pp)
      }
    } catch {
      hydrating = false
    }
  }

  initFromIdb()

  // ── Watcher: save structure to localStorage + schedule IDB image sync ─────
  // flush:'post' batches rapid mutations (e.g. applyRemoteState) into one call
  watch(
    [tiers, pool],
    () => {
      if (hydrating) return
      saveStructure(tiers.value, pool.value)
      scheduleIdbSync()
    },
    { deep: true, flush: 'post' },
  )

  // ── Actions ───────────────────────────────────────────────────────────────

  function addImagesToPool(images: TierImage[]) {
    pool.value.push(...images)
  }

  function findAndRemoveImage(imageId: string): TierImage | null {
    const poolIdx = pool.value.findIndex(img => img.id === imageId)
    if (poolIdx !== -1) return pool.value.splice(poolIdx, 1)[0] ?? null
    for (const tier of tiers.value) {
      const idx = tier.items.findIndex(img => img.id === imageId)
      if (idx !== -1) return tier.items.splice(idx, 1)[0] ?? null
    }
    return null
  }

  function moveToTier(tierId: string, imageId: string, beforeImageId?: string) {
    const img  = findAndRemoveImage(imageId)
    if (!img) return
    const tier = tiers.value.find(t => t.id === tierId)
    if (!tier) return
    if (beforeImageId) {
      const idx = tier.items.findIndex(i => i.id === beforeImageId)
      if (idx !== -1) { tier.items.splice(idx, 0, img); return }
    }
    tier.items.push(img)
  }

  function moveToPool(imageId: string) {
    const img = findAndRemoveImage(imageId)
    if (!img) return
    pool.value.push(img)
  }

  function removeImage(imageId: string) {
    findAndRemoveImage(imageId)
  }

  function addTier() {
    const colorIdx = tiers.value.length % TIER_COLORS.length
    tiers.value.push({
      id:    generateId(),
      label: 'New',
      color: TIER_COLORS[colorIdx] ?? '#7f7f7f',
      items: [],
    })
  }

  function removeTier(tierId: string) {
    const idx = tiers.value.findIndex(t => t.id === tierId)
    if (idx === -1) return
    pool.value.push(...(tiers.value[idx]?.items ?? []))
    tiers.value.splice(idx, 1)
  }

  function moveTierUp(tierId: string) {
    const idx = tiers.value.findIndex(t => t.id === tierId)
    if (idx <= 0) return
    const tier = tiers.value.splice(idx, 1)[0]
    if (!tier) return
    tiers.value.splice(idx - 1, 0, tier)
  }

  function moveTierDown(tierId: string) {
    const idx = tiers.value.findIndex(t => t.id === tierId)
    if (idx === -1 || idx >= tiers.value.length - 1) return
    const tier = tiers.value.splice(idx, 1)[0]
    if (!tier) return
    tiers.value.splice(idx + 1, 0, tier)
  }

  function updateTierLabel(tierId: string, label: string) {
    const tier = tiers.value.find(t => t.id === tierId)
    // Enforce same 20-char limit even from remote peers
    if (tier) tier.label = label.slice(0, 20)
  }

  function updateTierColor(tierId: string, color: string) {
    // Validate hex color to prevent CSS injection via collaboration
    if (!isSafeColor(color)) return
    const tier = tiers.value.find(t => t.id === tierId)
    if (tier) tier.color = color
  }

  function clearTier(tierId: string) {
    const tier = tiers.value.find(t => t.id === tierId)
    if (!tier) return
    pool.value.push(...tier.items)
    tier.items = []
  }

  function clearAll() {
    for (const tier of tiers.value) {
      pool.value.push(...tier.items)
      tier.items = []
    }
  }

  function clearPool() {
    pool.value = []
  }

  function reorderPool(imageId: string, toIndex: number) {
    const fromIndex = pool.value.findIndex(img => img.id === imageId)
    if (fromIndex === -1) return
    const img = pool.value[fromIndex]!
    pool.value.splice(fromIndex, 1)
    const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex
    pool.value.splice(adjusted, 0, img)
  }

  function applyRemoteState(remoteTiers: TierConfig[], remotePool: TierImage[]) {
    // If IDB hydration is still in progress, queue this state and apply it after.
    // Discarding it would mean the peer's state is permanently lost for this session.
    if (hydrating) {
      pendingRemoteState = { tiers: remoteTiers, pool: remotePool }
      return
    }
    // Guard against malformed payloads from peers
    if (!Array.isArray(remoteTiers) || !Array.isArray(remotePool)) return

    // Build a lookup of images we currently have so we can restore src for items
    // that peers broadcast without image data (we strip src before sending to stay
    // within Supabase's broadcast size limits).
    const localSrcMap = new Map<string, string>()
    for (const img of collectAllImages()) {
      if (img.src) localSrcMap.set(img.id, img.src)
    }

    // Security: strip items with unsafe/suspicious src values (SVG injection, javascript: URIs)
    for (const tier of remoteTiers) {
      if (!Array.isArray(tier?.items)) { tier.items = []; continue }
      tier.items = tier.items.filter(
        item => item && typeof item.id === 'string' && isSafeSrc(item.src ?? ''),
      )
      // Restore our local src for items the peer sent without image data
      for (const item of tier.items) {
        if (!item.src) item.src = localSrcMap.get(item.id) ?? ''
      }
    }
    const safePool = remotePool.filter(
      item => item && typeof item.id === 'string' && isSafeSrc(item.src ?? ''),
    )
    for (const item of safePool) {
      if (!item.src) item.src = localSrcMap.get(item.id) ?? ''
    }

    tiers.value = remoteTiers
    pool.value  = safePool
    scheduleIdbSync()
  }

  return {
    tiers,
    pool,
    draggingItem,
    addImagesToPool,
    moveToTier,
    moveToPool,
    removeImage,
    reorderPool,
    addTier,
    removeTier,
    moveTierUp,
    moveTierDown,
    updateTierLabel,
    updateTierColor,
    clearTier,
    clearAll,
    clearPool,
    applyRemoteState,
  }
})
