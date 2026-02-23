<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useTierStore, storageFullWarning } from '@/stores/tierStore'
import { useCollaboration } from '@/composables/useCollaboration'
import TierRow from '@/components/TierRow.vue'
import ImagePool from '@/components/ImagePool.vue'
import type { TierImage } from '@/stores/tierStore'

const store = useTierStore()

// --- Collaboration ---
// Room ID diambil dari URL query param: ?room=abc123
const urlRoom = new URLSearchParams(window.location.search).get('room') ?? ''
const { isConnected, peerCount, isSyncing } = useCollaboration(urlRoom)

const roomId = ref<string>(urlRoom)
const copied = ref(false)

function startCollaboration() {
  // Generate room ID 6 karakter, redirect ke URL baru (page reload sekali)
  const newRoom = Math.random().toString(36).slice(2, 8)
  window.location.href = `${window.location.pathname}?room=${newRoom}`
}

function leaveRoom() {
  window.location.href = window.location.pathname
}

async function copyShareLink() {
  await navigator.clipboard.writeText(window.location.href)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

// --- Paste handler ---
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function handlePaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (!file) continue

      const reader = new FileReader()
      reader.onload = (evt) => {
        const img: TierImage = {
          id: generateId(),
          src: evt.target!.result as string,
          name: 'pasted-image',
        }
        store.addImagesToPool([img])
      }
      reader.readAsDataURL(file)
    }
  }
}

onMounted(() => window.addEventListener('paste', handlePaste))
onUnmounted(() => window.removeEventListener('paste', handlePaste))
</script>

<template>
  <div class="app">
    <!-- Storage full warning toast -->
    <Transition name="toast">
      <div v-if="storageFullWarning" class="toast toast-warning" role="alert">
        ⚠ Storage penuh — gambar tidak tersimpan. Hapus beberapa gambar untuk melanjutkan.
      </div>
    </Transition>

    <header class="app-header">
      <div class="header-inner">
        <div class="header-left">
          <h1 class="app-title">Tier Maker</h1>
          <p class="app-subtitle">
            Drag images into tiers · Double-click labels to rename · Right-click to remove
          </p>
        </div>

        <!-- Collaboration bar -->
        <div class="collab-bar">
          <!-- Sedang dalam room -->
          <template v-if="roomId">
            <div class="room-status">
              <span
                class="status-dot"
                :class="{
                  syncing: isSyncing,
                  connected: !isSyncing && isConnected,
                  alone: !isSyncing && !isConnected,
                }"
              />
              <span class="room-label">Room</span>
              <code class="room-id">{{ roomId }}</code>
            </div>

            <span class="peer-info">
              <template v-if="isSyncing">Connecting...</template>
              <template v-else-if="peerCount > 0">
                {{ peerCount }} {{ peerCount === 1 ? 'other' : 'others' }} online
              </template>
              <template v-else>Waiting for others...</template>
            </span>

            <button class="collab-btn share" aria-label="Copy share link to clipboard" @click="copyShareLink">
              {{ copied ? '✓ Copied!' : '🔗 Copy Link' }}
            </button>
            <button class="collab-btn leave" aria-label="Leave collaboration room" @click="leaveRoom">
              Leave
            </button>
          </template>

          <!-- Belum dalam room -->
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
  padding: 12px 24px;
}

.header-inner {
  max-width: 1200px;
  margin: 0 auto;
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
  font-size: 20px;
  font-weight: 700;
  color: #fff;
}

.app-subtitle {
  font-size: 11px;
  color: #555;
  margin-top: 2px;
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

.status-dot.alone {
  background: #666;
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

.collab-btn {
  border: 1px solid #4a4a4a;
  border-radius: 5px;
  padding: 5px 12px;
  font-size: 12px;
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

/* --- Main layout --- */
.tier-maker {
  flex: 1;
  max-width: 1200px;
  width: 100%;
  margin: 24px auto;
  padding: 0 16px;
}

.tiers-container {
  border: 1px solid #3a3a3a;
  border-radius: 4px 4px 0 0;
}

.action-bar {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  background: #1e1e1e;
  border: 1px solid #3a3a3a;
  border-top: none;
}

.btn {
  background: #2e2e2e;
  border: 1px solid #4a4a4a;
  color: #ddd;
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
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

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.25s, transform 0.25s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
