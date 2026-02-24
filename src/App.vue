<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useTierStore, storageFullWarning } from '@/stores/tierStore'
import { useCollaboration, hasCollabBackend } from '@/composables/useCollaboration'
import { useImageModal } from '@/composables/useImageModal'
import TierRow from '@/components/TierRow.vue'
import ImagePool from '@/components/ImagePool.vue'
import type { TierImage } from '@/stores/tierStore'
import { resizeImage } from '@/lib/resizeImage'

const store = useTierStore()
const { activeImage, closeModal } = useImageModal()

const pasteError = ref(false)
const isPasting = ref(false)
let pasteErrorTimer: ReturnType<typeof setTimeout> | null = null
function showPasteError() {
  if (pasteErrorTimer) clearTimeout(pasteErrorTimer)
  pasteError.value = true
  pasteErrorTimer = setTimeout(() => { pasteError.value = false; pasteErrorTimer = null }, 4000)
}

// --- Collaboration ---
const urlRoom = new URLSearchParams(window.location.search).get('room') ?? ''
const { isConnected, peerCount, isSyncing } = useCollaboration(urlRoom)

const roomId = ref<string>(urlRoom)
const copied = ref(false)

function startCollaboration() {
  const newRoom = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  window.location.href = `${window.location.pathname}?room=${newRoom}`
}

function leaveRoom() {
  window.location.href = window.location.pathname
}

function reconnect() {
  window.location.reload()
}

async function copyShareLink() {
  await navigator.clipboard.writeText(window.location.href)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

// --- Paste handler ---
function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

async function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  const imageItems = [...items].filter(item => item.type.startsWith('image/'))
  if (imageItems.length === 0) return

  isPasting.value = true
  const results = await Promise.allSettled(
    imageItems.map(item => {
      const file = item.getAsFile()
      if (!file) return Promise.reject(new Error('No file'))
      return resizeImage(file).then(src => {
        const img: TierImage = { id: generateId(), src, name: 'pasted-image' }
        store.addImagesToPool([img])
      })
    }),
  )
  isPasting.value = false
  const failed = results.filter(r => r.status === 'rejected').length
  if (failed > 0) showPasteError()
}

// --- Global keyboard handlers ---
function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && activeImage.value) {
    closeModal()
  }
}

onMounted(() => {
  window.addEventListener('paste', handlePaste)
  window.addEventListener('keydown', handleKeyDown)
})
onUnmounted(() => {
  window.removeEventListener('paste', handlePaste)
  window.removeEventListener('keydown', handleKeyDown)
})
</script>

<template>
  <div class="app">
    <!-- Storage full warning toast -->
    <Transition name="toast">
      <div v-if="storageFullWarning" class="toast toast-warning" role="alert">
        ⚠ Storage penuh — gambar tetap bisa dipakai sesi ini, tapi tidak tersimpan setelah refresh.
      </div>
    </Transition>

    <!-- Paste loading toast -->
    <Transition name="toast">
      <div v-if="isPasting" class="toast toast-info" role="alert">
        Memproses gambar dari clipboard...
      </div>
    </Transition>

    <!-- Paste error toast -->
    <Transition name="toast">
      <div v-if="pasteError" class="toast toast-error" role="alert">
        ⚠ Gagal membaca gambar dari clipboard.
      </div>
    </Transition>

    <header class="app-header">
      <div class="header-inner">
        <div class="header-left">
          <h1 class="app-title">Tier Maker</h1>
          <p class="app-subtitle">
            Drag images into tiers · Click to preview · Double-click labels to rename · Right-click to remove
          </p>
        </div>

        <!-- Collaboration bar (only shown when Supabase env vars are set) -->
        <div v-if="hasCollabBackend" class="collab-bar">
          <template v-if="roomId">
            <div class="room-status" :class="{ 'room-offline': !isSyncing && !isConnected }">
              <span
                class="status-dot"
                :class="{
                  syncing:   isSyncing,
                  connected: !isSyncing && isConnected,
                  offline:   !isSyncing && !isConnected,
                }"
              />
              <span class="room-label">Room</span>
              <code class="room-id">{{ roomId }}</code>
            </div>

            <span class="peer-info" :class="{ 'peer-offline': !isSyncing && !isConnected }">
              <template v-if="isSyncing">Connecting...</template>
              <template v-else-if="!isConnected">Offline</template>
              <template v-else-if="peerCount > 0">
                {{ peerCount }} {{ peerCount === 1 ? 'other' : 'others' }} online
              </template>
              <template v-else>Online — just you</template>
            </span>

            <button
              v-if="!isSyncing && !isConnected"
              class="collab-btn reconnect"
              aria-label="Reconnect to collaboration room"
              @click="reconnect"
            >
              ↻ Reconnect
            </button>

            <button class="collab-btn share" aria-label="Copy share link to clipboard" @click="copyShareLink">
              {{ copied ? '✓ Copied!' : '🔗 Copy Link' }}
            </button>
            <button class="collab-btn leave" aria-label="Leave collaboration room" @click="leaveRoom">
              Leave
            </button>
          </template>

          <button v-else class="collab-btn start" aria-label="Start collaboration session" @click="startCollaboration">
            👥 Collaborate
          </button>
        </div>
      </div>
    </header>

    <main class="tier-maker">
      <div class="tiers-container">
        <TierRow
          v-for="(tier, index) in store.tiers"
          :key="tier.id"
          :tier="tier"
          :isFirst="index === 0"
          :isLast="index === store.tiers.length - 1"
        />
      </div>

      <div class="action-bar">
        <button class="btn" @click="store.addTier()">+ Add Tier</button>
        <button class="btn secondary" @click="store.clearAll()" title="Move all items back to pool">
          Reset All
        </button>
      </div>

      <ImagePool />
    </main>

    <!-- Image preview modal -->
    <Teleport to="body">
      <Transition name="modal">
        <div
          v-if="activeImage"
          class="modal-overlay"
          @click.self="closeModal"
        >
          <div class="modal-content">
            <button class="modal-close" @click="closeModal" aria-label="Close preview">×</button>
            <img
              :src="activeImage.src"
              :alt="activeImage.name || 'Image preview'"
              class="modal-image"
            />
            <p v-if="activeImage.name && activeImage.name !== 'pasted-image'" class="modal-name">
              {{ activeImage.name }}
            </p>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body {
  min-height: 100vh;
  background: #111;
  color: #e0e0e0;
  font-family: 'Segoe UI', Arial, sans-serif;
}

#app {
  min-height: 100vh;
}
</style>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background: #1a1a1a;
  border-bottom: 1px solid #333;
  padding: 14px 40px;
}

.header-inner {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.header-left {
  flex: 1;
  min-width: 0;
}

.app-title {
  font-size: 28px;
  font-weight: 700;
  color: #fff;
}

.app-subtitle {
  font-size: 13px;
  color: #555;
  margin-top: 3px;
}

/* --- Collab bar --- */
.collab-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.room-status {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #242424;
  border: 1px solid #3a3a3a;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.syncing {
  background: #f0a500;
  animation: pulse 1s infinite;
}

.status-dot.connected {
  background: #4caf50;
}

.status-dot.offline {
  background: #e05050;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.room-label {
  color: #666;
  font-size: 11px;
}

.room-id {
  font-family: monospace;
  font-size: 13px;
  color: #ddd;
  letter-spacing: 1px;
}

.peer-info {
  font-size: 12px;
  color: #888;
}

.peer-info.peer-offline {
  color: #e05050;
  font-weight: 600;
}

.room-status.room-offline {
  border-color: #6a2a2a;
}

.collab-btn {
  border: 1px solid #4a4a4a;
  border-radius: 5px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  white-space: nowrap;
}

.collab-btn.start {
  background: #1a3a5c;
  border-color: #2a5a8c;
  color: #7ab8f5;
}

.collab-btn.start:hover {
  background: #234c78;
  color: #9dd0ff;
}

.collab-btn.share {
  background: #1a3a1a;
  border-color: #2a6a2a;
  color: #7af57a;
}

.collab-btn.share:hover {
  background: #234c23;
  color: #9dff9d;
}

.collab-btn.leave {
  background: #3a1a1a;
  border-color: #6a2a2a;
  color: #f57a7a;
}

.collab-btn.leave:hover {
  background: #4c2323;
  color: #ff9d9d;
}

.collab-btn.reconnect {
  background: #3a2800;
  border-color: #7a5500;
  color: #f0a500;
}

.collab-btn.reconnect:hover {
  background: #4c3500;
  color: #ffc040;
}

/* --- Main layout --- */
.tier-maker {
  flex: 1;
  width: 100%;
  margin: 28px 0;
  padding: 0 40px;
}

.tiers-container {
  border: 1px solid #3a3a3a;
  border-radius: 4px 4px 0 0;
}

.action-bar {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-top: none;
}

.btn {
  background: #2e2e2e;
  border: 1px solid #4a4a4a;
  color: #ddd;
  padding: 7px 20px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s, color 0.15s;
}

.btn:hover {
  background: #3e3e3e;
  color: #fff;
}

.btn.secondary {
  color: #888;
}

.btn.secondary:hover {
  color: #ccc;
}

/* Toast notifications */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 11px 20px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.toast-warning {
  background: #4a3000;
  border: 1px solid #8a6000;
  color: #ffd080;
}

.toast-error {
  background: #6b1a1a;
  border: 1px solid #a03030;
  color: #ffaaaa;
}

.toast-info {
  background: #1a3a1a;
  border: 1px solid #2a6a2a;
  color: #7af57a;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}

/* --- Image preview modal --- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 24px;
  cursor: zoom-out;
}

.modal-content {
  position: relative;
  max-width: min(90vw, 900px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  cursor: default;
}

.modal-image {
  max-width: 100%;
  max-height: calc(90vh - 60px);
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6);
  display: block;
  background: #1a1a1a;
}

.modal-name {
  color: #aaa;
  font-size: 13px;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.modal-close {
  position: absolute;
  top: -14px;
  right: -14px;
  width: 32px;
  height: 32px;
  background: #333;
  border: 1px solid #555;
  color: #ccc;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  transition: background 0.15s, color 0.15s;
}

.modal-close:hover {
  background: #c0392b;
  border-color: #e74c3c;
  color: #fff;
}

.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-active .modal-content,
.modal-leave-active .modal-content {
  transition: transform 0.2s ease;
}
.modal-enter-from .modal-content,
.modal-leave-to .modal-content {
  transform: scale(0.92);
}
</style>
