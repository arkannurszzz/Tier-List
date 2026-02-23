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
    // Reset after Vue's post-flush watcher has run, so the collab watch
    // sees applyingRemote=true and skips broadcasting the just-applied state
    nextTick(() => { applyingRemote = false })
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

  function broadcastState() {
    if (applyingRemote) return
    // Never send before the WebSocket is connected — channel.send() would fall
    // back to Supabase's REST broadcast endpoint and get a 422 error because
    // the channel isn't active on the server yet.
    if (!isConnected.value) return
    if (broadcastTimer) clearTimeout(broadcastTimer)
    broadcastTimer = setTimeout(() => {
      channel.send({
        type: 'broadcast',
        event: 'state',
        payload: slimPayload(),
      })
    }, 200)
  }

  // Another peer just joined and is requesting the current state
  channel.on('broadcast', { event: 'request-state' }, () => {
    channel.send({
      type: 'broadcast',
      event: 'state',
      payload: slimPayload(),
    })
  })

  // A peer broadcast their full state
  channel.on('broadcast', { event: 'state' }, ({ payload }) => {
    applyRemoteState(payload as StatePayload)
  })

  // Track presence for peer count
  channel.on('presence', { event: 'sync' }, () => {
    const states = channel.presenceState()
    peerCount.value = Math.max(0, Object.keys(states).length - 1)
  })
  channel.on('presence', { event: 'join' }, () => {
    const states = channel.presenceState()
    peerCount.value = Math.max(0, Object.keys(states).length - 1)
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
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
      isConnected.value = false
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
