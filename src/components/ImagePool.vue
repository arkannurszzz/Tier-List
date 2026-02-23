<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTierStore } from '@/stores/tierStore'
import type { TierImage } from '@/stores/tierStore'
import TierItem from './TierItem.vue'

const store = useTierStore()

const isDragOver = ref(false)
const insertIndex = ref<number | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

// Bersihkan insert indicator otomatis saat drag selesai
watch(
  () => store.draggingItem,
  (val) => { if (!val) insertIndex.value = null },
)

function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const readError = ref<string | null>(null)

function readFilesAsImages(files: FileList | File[]) {
  const arr = Array.from(files)
  for (const file of arr) {
    if (!file.type.startsWith('image/')) continue
    const reader = new FileReader()
    reader.onload = (e) => {
      const img: TierImage = {
        id: generateId(),
        src: e.target!.result as string,
        name: file.name,
      }
      store.addImagesToPool([img])
    }
    reader.onerror = () => {
      readError.value = `Gagal membaca "${file.name}". Coba file lain.`
      setTimeout(() => (readError.value = null), 4000)
    }
    reader.readAsDataURL(file)
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
  // Hanya aktif kalau drag dari dalam pool
  if (!store.draggingItem || store.draggingItem.source !== 'pool') return

  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  // Kiri = insert sebelum, kanan = insert sesudah
  insertIndex.value = e.clientX < rect.left + rect.width / 2 ? index : index + 1
}

function onItemDrop(e: DragEvent) {
  if (!store.draggingItem) return

  if (store.draggingItem.source === 'pool' && insertIndex.value !== null) {
    // Stop propagation supaya pool container tidak handle juga
    e.stopPropagation()
    store.reorderPool(store.draggingItem.imageId, insertIndex.value)
  }
  // Kalau bukan dari pool, biarkan event bubble ke pool container
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
    <!-- Error toast -->
    <Transition name="toast">
      <div v-if="readError" class="toast toast-error" role="alert">{{ readError }}</div>
    </Transition>

    <div class="pool-header">
      <span class="pin-icon">📌</span>
      <span class="pool-title">Image Pool</span>
      <div class="pool-actions">
        <button class="action-btn" @click="openFileDialog">Upload Images</button>
        <span class="hint">or Ctrl+V to paste</span>
        <button
          v-if="store.pool.length > 0"
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

      <div v-if="store.pool.length === 0" class="pool-empty">
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
  background: #3a3a3a;
  border: 1px solid #555;
  color: #ddd;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}

.action-btn:hover {
  background: #4a4a4a;
  color: #fff;
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

.pool-items {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 12px;
  min-height: 110px;
  transition: background 0.15s;
}

.pool-items.drag-over {
  background: #252525;
  outline: 2px dashed #666;
  outline-offset: -4px;
}

/* Wrapper untuk tiap item — posisi relative supaya insert line bisa absolute */
.pool-item-wrapper {
  position: relative;
  flex-shrink: 0;
}

/* Garis biru di KIRI item = insert sebelum item ini */
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

/* Garis biru di KANAN item terakhir = insert di paling akhir */
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
}

.toast-error {
  background: #6b1a1a;
  border: 1px solid #a03030;
  color: #ffaaaa;
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
