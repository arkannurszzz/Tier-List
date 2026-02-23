import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { ref, watch, onUnmounted, nextTick } from 'vue'
import type { TierConfig, TierImage } from '@/stores/tierStore'
import { useTierStore } from '@/stores/tierStore'

// WebSocket server URL — set VITE_WS_SERVER in Vercel env vars
// pointing to your deployed ws-server (see ws-server/ directory).
// Default falls back to the public Yjs demo server for quick testing.
const WS_SERVER = (import.meta.env.VITE_WS_SERVER as string | undefined) ?? 'wss://demos.yjs.dev'

export function useCollaboration(roomId: string) {
  if (!roomId) {
    return { isConnected: ref(false), peerCount: ref(0), isSyncing: ref(false) }
  }

  const store = useTierStore()
  const isConnected = ref(false)
  const peerCount = ref(0)
  const isSyncing = ref(true)

  const ydoc = new Y.Doc()
  const provider = new WebsocketProvider(WS_SERVER, `tier-maker-${roomId}`, ydoc)
  const yState = ydoc.getMap<string>('state')

  let applyingRemote = false
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
      nextTick(() => { applyingRemote = false })
    } catch {
      applyingRemote = false
    }
    return true
  }

  function broadcastState() {
    if (applyingRemote) return
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
  }
  provider.awareness.on('change', updatePeerCount)

  // 'sync' fires with true when the document is fully in sync with the server
  const syncFallback = setTimeout(() => {
    if (!isSyncing.value) return
    isSyncing.value = false
    if (!yState.get('tiers')) broadcastState()
  }, 6000)

  provider.on('sync', (synced: boolean) => {
    if (!synced) return
    clearTimeout(syncFallback)
    isSyncing.value = false
    if (!applyYjsState()) broadcastState()
  })

  provider.on('status', (event: { status: 'connected' | 'disconnected' | 'connecting' }) => {
    isConnected.value = event.status === 'connected'
    if (event.status === 'connected') updatePeerCount()
  })

  const stopWatch = watch(
    [() => store.tiers, () => store.pool],
    () => { if (!applyingRemote) broadcastState() },
    { deep: true },
  )

  onUnmounted(() => {
    if (broadcastTimer) clearTimeout(broadcastTimer)
    clearTimeout(syncFallback)
    stopWatch()
    provider.awareness.off('change', updatePeerCount)
    provider.disconnect()
    provider.destroy()
    ydoc.destroy()
  })

  return { isConnected, peerCount, isSyncing }
}
