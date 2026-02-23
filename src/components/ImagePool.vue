<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTierStore } from '@/stores/tierStore'
import type { TierImage } from '@/stores/tierStore'
import TierItem from './TierItem.vue'
import { resizeImage } from '@/lib/resizeImage'

const store = useTierStore()

const isDragOver = ref(false)
const insertIndex = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const isUploading = ref(false)

// Status toast
type ToastType = 'error' | 'warn' | 'info'
const statusMsg = ref<{ text: string; type: ToastType } | null>(null)
let statusTimer: ReturnType<typeof setTimeout> | null = null

function showStatus(text: string, type: ToastType, duration = 4000) {
  if (statusTimer) clearTimeout(statusTimer)
  statusMsg.value = { text, type }
  statusTimer = setTimeout(() => { statusMsg.value = null; statusTimer = null }, duration)
}

// Bersihkan insert indicator otomatis saat drag selesai
watch(
  () => store.draggingItem,
  (val) => { if (!val) insertIndex.value = null },
)

function generateId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}


async function readFilesAsImages(files: FileList | File[]) {
  const arr = Array.from(files)
  const imageFiles = arr.filter(f => f.type.startsWith('image/'))
  const skippedCount = arr.length - imageFiles.length

  if (imageFiles.length === 0) {
    if (skippedCount > 0) showStatus(`${skippedCount} file bukan gambar, dilewati`, 'warn')
    return
  }

  isUploading.value = true

  // Process all files concurrently, collect results
  const results = await Promise.allSettled(
    imageFiles.map(async (file) => {
      const src = await resizeImage(file)
      return { id: generateId(), src, name: file.name } as TierImage
    }),
  )

  const images: TierImage[] = []
  let failedCount = 0
  for (const r of results) {
    if (r.status === 'fulfilled') images.push(r.value)
    else failedCount++
  }

  // Add all at once — single store mutation = single localStorage write
  if (images.length > 0) store.addImagesToPool(images)

  isUploading.value = false

  // Feedback — only show toast when something went wrong or was skipped
  const parts: string[] = []
  if (failedCount > 0) parts.push(`${failedCount} gagal dibaca`)
  if (skippedCount > 0) parts.push(`${skippedCount} bukan gambar`)

  if (parts.length > 0) {
    const prefix = images.length > 0 ? `${images.length} berhasil · ` : ''
    showStatus(prefix + parts.join(' · '), failedCount > 0 ? 'error' : 'warn', 5000)
  }
}

// --- Pool container handlers ---
function onDragOver(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = true
}

function onDragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement
  if (!target.contains(e.relatedTarget as Node)) {
    isDragOver.value = false
    insertIndex.value = null
  }
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragOver.value = false
  insertIndex.value = null

  // OS file drop
  if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
    readFilesAsImages(e.dataTransfer.files)
    return
  }

  // Tier item → pool (append to end)
  if (store.draggingItem && store.draggingItem.source !== 'pool') {
    store.moveToPool(store.draggingItem.imageId)
  }
}

// --- Per-item handlers (untuk reorder) ---
function onItemDragOver(e: DragEvent, index: number) {
  if (!store.draggingItem || store.draggingItem.source !== 'pool') return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  insertIndex.value = e.clientX < rect.left + rect.width / 2 ? index : index + 1
}

function onItemDrop(e: DragEvent) {
  if (!store.draggingItem) return
  if (store.draggingItem.source === 'pool' && insertIndex.value !== null) {
    e.stopPropagation()
    store.reorderPool(store.draggingItem.imageId, insertIndex.value)
  }
  insertIndex.value = null
  isDragOver.value = false
}

// --- File upload ---
function openFileDialog() {
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files && input.files.length > 0) {
    readFilesAsImages(input.files)
    input.value = ''
  }
}

defineExpose({ readFilesAsImages })
</script>

<template>
  <div class="image-pool">
    <!-- Status toast -->
    <Transition name="toast">
      <div
        v-if="statusMsg"
        class="toast"
        :class="`toast-${statusMsg.type}`"
        role="alert"
      >{{ statusMsg.text }}</div>
    </Transition>

    <div class="pool-header">
      <span class="pin-icon">📌</span>
      <span class="pool-title">Image Pool</span>
      <div class="pool-actions">
        <button
          class="action-btn"
          :disabled="isUploading"
          @click="openFileDialog"
        >
          <span v-if="isUploading" class="spinner" aria-hidden="true" />
          {{ isUploading ? 'Uploading...' : 'Upload Images' }}
        </button>
        <span class="hint">or Ctrl+V to paste</span>
        <button
          v-if="store.pool.length > 0 && !isUploading"
          class="action-btn danger"
          @click="store.clearPool()"
          title="Remove all images from pool"
        >Clear Pool</button>
      </div>
    </div>

    <div
      class="pool-items"
      :class="{ 'drag-over': isDragOver && insertIndex === null }"
      data-pool-drop
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div
        v-for="(item, index) in store.pool"
        :key="item.id"
        class="pool-item-wrapper"
        :class="{
          'insert-before': insertIndex === index,
          'insert-after': insertIndex === store.pool.length && index === store.pool.length - 1,
        }"
        @dragover.prevent="onItemDragOver($event, index)"
        @drop="onItemDrop($event)"
      >
        <TierItem :image="item" source="pool" />
      </div>

      <!-- Upload loading overlay: always show when uploading, below existing items -->
      <div v-if="isUploading" class="pool-uploading" :class="{ inline: store.pool.length > 0 }">
        <span class="spinner large" />
        <p>Memproses gambar...</p>
      </div>

      <div v-else-if="store.pool.length === 0" class="pool-empty">
        <p>Drop images here · Upload files · Paste from clipboard (Ctrl+V)</p>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="image/*"
      multiple
      class="hidden-input"
      @change="onFileChange"
    />
  </div>
</template>

<style scoped>
.image-pool {
  background: #1c1c1c;
  border: 1px solid #3a3a3a;
  border-top: none;
}

.pool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #242424;
  border-bottom: 1px solid #3a3a3a;
  flex-wrap: wrap;
}

.pin-icon {
  font-size: 16px;
}

.pool-title {
  color: #ddd;
  font-size: 14px;
  font-weight: 600;
}

.pool-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #3a3a3a;
  border: 1px solid #555;
  color: #ddd;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s, opacity 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: #4a4a4a;
  color: #fff;
}

.action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.action-btn.danger {
  background: #4a1a1a;
  border-color: #6b2a2a;
  color: #f88;
}

.action-btn.danger:hover {
  background: #6b2020;
  color: #faa;
}

.hint {
  color: #666;
  font-size: 11px;
}

/* Spinner */
.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.25);
  border-top-color: #ddd;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}

.spinner.large {
  width: 28px;
  height: 28px;
  border-width: 3px;
  border-top-color: #7ab8f5;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.pool-items {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 16px;
  min-height: 140px;
  transition: background 0.15s;
}

.pool-items.drag-over {
  background: #252525;
  outline: 2px dashed #666;
  outline-offset: -4px;
}

.pool-item-wrapper {
  position: relative;
  flex-shrink: 0;
}

/* Insert indicator lines */
.pool-item-wrapper.insert-before::before {
  content: '';
  position: absolute;
  left: -3px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #4af;
  border-radius: 2px;
  z-index: 20;
}

.pool-item-wrapper.insert-after::after {
  content: '';
  position: absolute;
  right: -3px;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #4af;
  border-radius: 2px;
  z-index: 20;
}

.pool-uploading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  color: #666;
  font-size: 13px;
  padding: 16px;
}

/* When pool already has items, show as a compact tile next to them */
.pool-uploading.inline {
  width: 100px;
  height: 100px;
  padding: 8px;
  flex-shrink: 0;
  font-size: 11px;
  gap: 6px;
}

.pool-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  color: #555;
  font-size: 13px;
  text-align: center;
  padding: 16px;
  pointer-events: none;
}

.hidden-input {
  display: none;
}

/* Toast */
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 13px;
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
  max-width: calc(100vw - 48px);
  overflow: hidden;
  text-overflow: ellipsis;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}

.toast-error {
  background: #6b1a1a;
  border: 1px solid #a03030;
  color: #ffaaaa;
}

.toast-warn {
  background: #4a3000;
  border: 1px solid #8a6000;
  color: #ffd080;
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
</style>
