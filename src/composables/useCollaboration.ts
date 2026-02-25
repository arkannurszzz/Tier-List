import { createClient } from '@supabase/supabase-js'
import { ref, watch, onUnmounted, nextTick } from 'vue'
import type { TierConfig, TierImage } from '@/stores/tierStore'
import { useTierStore } from '@/stores/tierStore'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const hasCollabBackend = !!(SUPABASE_URL && SUPABASE_ANON_KEY)

const supabase = hasCollabBackend
  ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!)
  : null

interface StatePayload {
  tiers: TierConfig[]
  pool: TierImage[]
}

export function useCollaboration(roomId: string) {
  if (!roomId || !supabase) {
    return { isConnected: ref(false), peerCount: ref(0), isSyncing: ref(false) }
  }

  const store = useTierStore()
  const isConnected = ref(false)
  const peerCount = ref(0)
  const isSyncing = ref(true)

  let applyingRemote = false
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null
  const clientId = crypto.randomUUID()

  const channel = supabase.channel(`tier-maker-${roomId}`, {
    config: {
      broadcast: { self: false },
      presence: { key: clientId },
    },
  })

  function applyRemoteState(payload: StatePayload) {
    applyingRemote = true
    store.applyRemoteState(payload.tiers, payload.pool)
    // After applying, request image data for any images we don't have locally.
    // This fixes the case where a peer adds a new image: the slim broadcast has
    // src='' for that image, and our local IDB doesn't have it yet, so we ask
    // the sender to give us the actual base64 data.
    requestMissingImages()
    // Reset after Vue's post-flush watcher has run, so the collab watch
    // sees applyingRemote=true and skips broadcasting the just-applied state
    nextTick(() => { applyingRemote = false })
  }

  // Send a broadcast asking peers for image data we're missing (src === '')
  function requestMissingImages() {
    if (!isConnected.value) return
    const missingIds = store.collectAllImages()
      .filter(img => !img.src)
      .map(img => img.id)
    if (missingIds.length === 0) return
    channel.send({
      type: 'broadcast',
      event: 'request-images',
      payload: { ids: missingIds },
    })
  }

  // Strip image src before broadcasting: base64 data can be megabytes and will
  // exceed Supabase Realtime's message size limit (causing 422 errors). Each
  // peer restores src locally from their own IDB via applyRemoteState.
  function slimPayload(): StatePayload {
    return {
      tiers: store.tiers.map(t => ({
        ...t,
        items: t.items.map(i => ({ id: i.id, name: i.name, src: '' })),
      })),
      pool: store.pool.map(i => ({ id: i.id, name: i.name, src: '' })),
    }
  }

  // Central send helper: broadcast current state AND remove the sent image IDs
  // from the store's _localImageIds.  Once peers know about an image it's no
  // longer "locally exclusive", so any peer (including the uploader) can delete
  // it without the preserve-loop in applyRemoteState resurrecting it.
  function sendStatePayload(payload: StatePayload) {
    channel.send({ type: 'broadcast', event: 'state', payload })
    const ids = [
      ...payload.pool.map(i => i.id),
      ...payload.tiers.flatMap(t => t.items.map(i => i.id)),
    ]
    store.markAsBroadcasted(ids)
  }

  // Send state immediately (no debounce) — used when responding to a peer request
  // or when a new peer joins so they get our current state right away.
  function broadcastStateNow() {
    if (applyingRemote || !isConnected.value) return
    sendStatePayload(slimPayload())
  }

  function broadcastState() {
    if (applyingRemote) return
    // Never send before the WebSocket is connected — channel.send() would fall
    // back to Supabase's REST broadcast endpoint and get a 422 error because
    // the channel isn't active on the server yet.
    if (!isConnected.value) return
    if (broadcastTimer) clearTimeout(broadcastTimer)
    broadcastTimer = setTimeout(() => {
      sendStatePayload(slimPayload())
    }, 200)
  }

  // Another peer just joined and is requesting the current state
  channel.on('broadcast', { event: 'request-state' }, () => {
    broadcastStateNow()
  })

  // A peer broadcast their full state
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    applyRemoteState(payload as StatePayload)
  })

  // A peer is requesting image data for IDs they received without src
  channel.on('broadcast', { event: 'request-images' }, ({ payload }) => {
    const req = payload as { ids?: unknown }
    if (!Array.isArray(req?.ids)) return
    const requestedIds = new Set<string>(req.ids as string[])
    const toSend = store.collectAllImages().filter(img => img.src && requestedIds.has(img.id))
    if (toSend.length === 0) return
    // Batch images to stay under Supabase Realtime's ~1 MB message limit.
    // Images are max 1024×1024 JPEG @ 0.85 so typically 100–400 KB as base64.
    const BATCH_LIMIT = 700_000 // ~700 K base64 chars ≈ 525 KB decoded
    let batch: Array<{ id: string; src: string; name?: string }> = []
    let batchSize = 0
    for (const img of toSend) {
      if (batchSize + img.src.length > BATCH_LIMIT && batch.length > 0) {
        channel.send({ type: 'broadcast', event: 'image-data', payload: { images: batch } })
        batch = []
        batchSize = 0
      }
      batch.push({ id: img.id, src: img.src, name: img.name })
      batchSize += img.src.length
    }
    if (batch.length > 0) {
      channel.send({ type: 'broadcast', event: 'image-data', payload: { images: batch } })
    }
  })

  // A peer sent us image data — update our store without re-broadcasting
  channel.on('broadcast', { event: 'image-data' }, ({ payload }) => {
    const data = payload as { images?: unknown }
    if (!Array.isArray(data?.images)) return
    applyingRemote = true
    store.updateImageSrcs(data.images as Array<{ id: string; src: string; name?: string }>)
    nextTick(() => { applyingRemote = false })
  })

  // Track presence for peer count
  channel.on('presence', { event: 'sync' }, () => {
    const states = channel.presenceState()
    peerCount.value = Math.max(0, Object.keys(states).length - 1)
  })
  channel.on('presence', { event: 'join' }, () => {
    const states = channel.presenceState()
    const newCount = Math.max(0, Object.keys(states).length - 1)
    // A new peer just joined — proactively push our state to them.
    // This is a safety net alongside the request-state/response handshake:
    // if the joiner's request-state broadcast is lost, they still get our state
    // because we push it as soon as we see them arrive in presence.
    if (newCount > peerCount.value) broadcastStateNow()
    peerCount.value = newCount
  })
  channel.on('presence', { event: 'leave' }, () => {
    const states = channel.presenceState()
    peerCount.value = Math.max(0, Object.keys(states).length - 1)
  })

  channel.subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      isConnected.value = true
      isSyncing.value = false
      await channel.track({ joined_at: Date.now() })
      // Ask peers for current state (in case we're late joiner)
      channel.send({
        type: 'broadcast',
        event: 'request-state',
        payload: {},
      })
    } else if (status === 'TIMED_OUT' || status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      isConnected.value = false
      isSyncing.value = false
    }
  })

  const stopWatch = watch(
    [() => store.tiers, () => store.pool],
    () => { if (!applyingRemote) broadcastState() },
    { deep: true },
  )

  onUnmounted(() => {
    if (broadcastTimer) clearTimeout(broadcastTimer)
    stopWatch()
    supabase.removeChannel(channel)
  })

  return { isConnected, peerCount, isSyncing }
}
