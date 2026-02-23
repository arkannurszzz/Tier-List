import * as Y from 'yjs'
import { WebrtcProvider } from 'y-webrtc'
import { ref, watch, onUnmounted, nextTick } from 'vue'
import type { TierConfig, TierImage } from '@/stores/tierStore'
import { useTierStore } from '@/stores/tierStore'

// Gunakan env var kalau ada, fallback ke public signaling servers
const SIGNALING_SERVERS = (import.meta.env.VITE_SIGNALING_SERVERS as string | undefined)
  ?.split(',')
  .map((s) => s.trim()) ?? ['wss://y-webrtc-eu.fly.dev', 'wss://y-webrtc-us.fly.dev']

type ProviderLike = {
  on: (event: string, cb: (data: { synced: boolean }) => void) => void
}

export function useCollaboration(roomId: string) {
  if (!roomId) {
    return { isConnected: ref(false), peerCount: ref(0), isSyncing: ref(false) }
  }

  const store = useTierStore()
  const isConnected = ref(false)
  const peerCount = ref(0)
  const isSyncing = ref(true)

  const ydoc = new Y.Doc()
  const provider = new WebrtcProvider(`tier-maker-${roomId}`, ydoc, {
    signaling: SIGNALING_SERVERS,
  })
  const yState = ydoc.getMap<string>('state')

  let applyingRemote = false
  // Debounce timer — hindari broadcast setiap karakter saat drag intensif
  let broadcastTimer: ReturnType<typeof setTimeout> | null = null

  function applyYjsState(): boolean {
    const tiersJson = yState.get('tiers')
    const poolJson = yState.get('pool')
    if (!tiersJson) return false

    try {
      const remoteTiers = JSON.parse(tiersJson) as TierConfig[]
      const remotePool = poolJson ? (JSON.parse(poolJson) as TierImage[]) : []
      applyingRemote = true
      store.applyRemoteState(remoteTiers, remotePool)
      nextTick(() => {
        applyingRemote = false
      })
    } catch {
      applyingRemote = false
    }
    return true
  }

  function broadcastState() {
    if (applyingRemote) return
    // Debounce: tunggu 200ms setelah perubahan terakhir sebelum broadcast
    if (broadcastTimer) clearTimeout(broadcastTimer)
    broadcastTimer = setTimeout(() => {
      ydoc.transact(() => {
        yState.set('tiers', JSON.stringify(store.tiers))
        yState.set('pool', JSON.stringify(store.pool))
      })
    }, 200)
  }

  yState.observe((event) => {
    if (event.transaction.local) return
    applyYjsState()
  })

  const updatePeerCount = () => {
    const n = Math.max(0, provider.awareness.getStates().size - 1)
    peerCount.value = n
    isConnected.value = n > 0
  }
  provider.awareness.on('change', updatePeerCount)

  const syncTimeout = setTimeout(() => {
    if (!isSyncing.value) return
    isSyncing.value = false
    if (!yState.get('tiers')) broadcastState()
  }, 3000)

  ;(provider as unknown as ProviderLike).on('synced', ({ synced }) => {
    if (!synced) return
    clearTimeout(syncTimeout)
    isSyncing.value = false
    if (!applyYjsState()) broadcastState()
  })

  const stopWatch = watch(
    [() => store.tiers, () => store.pool],
    () => {
      if (!applyingRemote) broadcastState()
    },
    { deep: true },
  )

  onUnmounted(() => {
    if (broadcastTimer) clearTimeout(broadcastTimer)
    clearTimeout(syncTimeout)
    stopWatch()
    provider.awareness.off('change', updatePeerCount)
    // Disconnect dari signaling server sebelum destroy
    provider.disconnect()
    provider.destroy()
    ydoc.destroy()
  })

  return { isConnected, peerCount, isSyncing }
}
