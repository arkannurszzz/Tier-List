import { ref, watch } from 'vue'
import { defineStore } from 'pinia'

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

const STORAGE_KEY = 'tier-maker-state'

const TIER_COLORS = [
  '#ff7f7f',
  '#ffbf7f',
  '#ffdf7f',
  '#ffff7f',
  '#bfff7f',
  '#7fbfff',
  '#bf7fff',
  '#ff7fbf',
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

interface SavedState {
  tiers: TierConfig[]
  pool: TierImage[]
}

function loadState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SavedState
  } catch {
    return null
  }
}

// Reactive flag yang bisa dibaca komponen untuk tampilkan warning
export const storageFullWarning = ref(false)
let warningDismissTimer: ReturnType<typeof setTimeout> | null = null

function clearWarning() {
  storageFullWarning.value = false
  if (warningDismissTimer) { clearTimeout(warningDismissTimer); warningDismissTimer = null }
}

function setWarning() {
  storageFullWarning.value = true
  if (warningDismissTimer) clearTimeout(warningDismissTimer)
  warningDismissTimer = setTimeout(() => {
    storageFullWarning.value = false
    warningDismissTimer = null
  }, 5000)
}

function saveState(tiers: TierConfig[], pool: TierImage[]) {
  const data = JSON.stringify({ tiers, pool })

  // First attempt: standard setItem
  try {
    localStorage.setItem(STORAGE_KEY, data)
    clearWarning()
    return
  } catch { /* quota exceeded — try fallback */ }

  // Fallback: some browsers (Safari) throw QuotaExceededError even when replacing
  // an existing key with SMALLER data because they check peak usage during the write.
  // Fix: remove old entry first, then write. If write still fails, restore old entry
  // to avoid silent data loss (e.g. user deleted images but old state persists).
  const backup = localStorage.getItem(STORAGE_KEY)
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }

  try {
    localStorage.setItem(STORAGE_KEY, data)
    clearWarning()
    return
  } catch { /* still too large */ }

  // Restore backup so old saved state isn't lost
  if (backup) {
    try { localStorage.setItem(STORAGE_KEY, backup) } catch { /* truly out of space */ }
  }

  setWarning()
}

export const useTierStore = defineStore('tier', () => {
  const saved = loadState()

  const tiers = ref<TierConfig[]>(
    saved?.tiers ??
      DEFAULT_TIERS.map((t) => ({ ...t, id: generateId() })),
  )

  const pool = ref<TierImage[]>(saved?.pool ?? [])

  // Tracks what is currently being dragged
  const draggingItem = ref<{ source: 'pool' | string; imageId: string } | null>(null)

  // Auto-save ke localStorage setiap kali tiers/pool berubah
  watch([tiers, pool], () => saveState(tiers.value, pool.value), { deep: true })

  function addImagesToPool(images: TierImage[]) {
    pool.value.push(...images)
  }

  function findAndRemoveImage(imageId: string): TierImage | null {
    const poolIdx = pool.value.findIndex((img) => img.id === imageId)
    if (poolIdx !== -1) {
      return pool.value.splice(poolIdx, 1)[0] ?? null
    }
    for (const tier of tiers.value) {
      const idx = tier.items.findIndex((img) => img.id === imageId)
      if (idx !== -1) {
        return tier.items.splice(idx, 1)[0] ?? null
      }
    }
    return null
  }

  function moveToTier(tierId: string, imageId: string, beforeImageId?: string) {
    const img = findAndRemoveImage(imageId)
    if (!img) return
    const tier = tiers.value.find((t) => t.id === tierId)
    if (!tier) return
    if (beforeImageId) {
      const idx = tier.items.findIndex((i) => i.id === beforeImageId)
      if (idx !== -1) {
        tier.items.splice(idx, 0, img)
        return
      }
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
      id: generateId(),
      label: 'New',
      color: TIER_COLORS[colorIdx] ?? '#7f7f7f',
      items: [],
    })
  }

  function removeTier(tierId: string) {
    const idx = tiers.value.findIndex((t) => t.id === tierId)
    if (idx === -1) return
    pool.value.push(...(tiers.value[idx]?.items ?? []))
    tiers.value.splice(idx, 1)
  }

  function moveTierUp(tierId: string) {
    const idx = tiers.value.findIndex((t) => t.id === tierId)
    if (idx <= 0) return
    const tier = tiers.value.splice(idx, 1)[0]
    if (!tier) return
    tiers.value.splice(idx - 1, 0, tier)
  }

  function moveTierDown(tierId: string) {
    const idx = tiers.value.findIndex((t) => t.id === tierId)
    if (idx === -1 || idx >= tiers.value.length - 1) return
    const tier = tiers.value.splice(idx, 1)[0]
    if (!tier) return
    tiers.value.splice(idx + 1, 0, tier)
  }

  function updateTierLabel(tierId: string, label: string) {
    const tier = tiers.value.find((t) => t.id === tierId)
    if (tier) tier.label = label
  }

  function updateTierColor(tierId: string, color: string) {
    const tier = tiers.value.find((t) => t.id === tierId)
    if (tier) tier.color = color
  }

  function clearTier(tierId: string) {
    const tier = tiers.value.find((t) => t.id === tierId)
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

  // Dipanggil oleh useCollaboration saat menerima state dari peer lain
  function applyRemoteState(remoteTiers: TierConfig[], remotePool: TierImage[]) {
    tiers.value = remoteTiers
    pool.value = remotePool
  }

  function reorderPool(imageId: string, toIndex: number) {
    const fromIndex = pool.value.findIndex((img) => img.id === imageId)
    if (fromIndex === -1) return
    const img = pool.value[fromIndex]!
    pool.value.splice(fromIndex, 1)
    // Adjust target index after removal
    const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex
    pool.value.splice(adjusted, 0, img)
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
