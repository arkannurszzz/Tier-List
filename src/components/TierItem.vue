<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import type { TierImage } from '@/stores/tierStore'
import { useTierStore } from '@/stores/tierStore'
import { useImageModal } from '@/composables/useImageModal'

const props = defineProps<{
  image: TierImage
  source: 'pool' | string
}>()

const store = useTierStore()
const { openModal } = useImageModal()
const isDragging = ref(false)

// --- Desktop drag (HTML5 DnD) ---
let didDragStart = false

function onDragStart(e: DragEvent) {
  didDragStart = true
  // Cancel any pending click so mouseup doesn't open modal after a drag
  clickPending = false
  store.draggingItem = { source: props.source, imageId: props.image.id }
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', props.image.id)
  }
}

function onDragEnd() {
  store.draggingItem = null
  isDragging.value = false
  // Small delay so any stray mouseup after drag doesn't open modal
  setTimeout(() => { didDragStart = false }, 80)
}

// Click-to-preview: use mousedown+mouseup distance tracking because
// @click on draggable="true" elements is unreliable in Chrome
let clickStartX = 0
let clickStartY = 0
let clickPending = false

function onMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  clickStartX = e.clientX
  clickStartY = e.clientY
  clickPending = true
}

function onMouseUp(e: MouseEvent) {
  if (!clickPending || e.button !== 0) return
  clickPending = false
  if (didDragStart) return
  const dist = Math.hypot(e.clientX - clickStartX, e.clientY - clickStartY)
  if (dist < 6) openModal(props.image.src, props.image.name)
}

// --- Touch / Mobile drag ---
let ghost: HTMLElement | null = null
let touchOffsetX = 0
let touchOffsetY = 0
let touchMoved = false

function cleanupGhost() {
  if (ghost) {
    ghost.remove()
    ghost = null
  }
}

function onTouchStart(e: TouchEvent) {
  if ((e.target as Element).closest('.remove-btn')) return
  touchMoved = false
  const touch = e.touches[0]
  if (!touch) return

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  touchOffsetX = touch.clientX - rect.left
  touchOffsetY = touch.clientY - rect.top

  store.draggingItem = { source: props.source, imageId: props.image.id }
  isDragging.value = true

  ghost = (e.currentTarget as HTMLElement).cloneNode(true) as HTMLElement
  // Remove the non-functional remove button from the ghost clone
  ghost.querySelector('.remove-btn')?.remove()
  ghost.style.cssText = `
    position: fixed;
    width: ${rect.width}px;
    height: ${rect.height}px;
    opacity: 0.7;
    pointer-events: none;
    z-index: 9999;
    left: ${touch.clientX - touchOffsetX}px;
    top: ${touch.clientY - touchOffsetY}px;
  `
  document.body.appendChild(ghost)
}

function onTouchMove(e: TouchEvent) {
  e.preventDefault()
  touchMoved = true
  const touch = e.touches[0]
  if (!touch || !ghost) return
  ghost.style.left = `${touch.clientX - touchOffsetX}px`
  ghost.style.top = `${touch.clientY - touchOffsetY}px`
}

function onTouchEnd(e: TouchEvent) {
  isDragging.value = false
  cleanupGhost()

  if (!touchMoved) {
    store.draggingItem = null
    const tapTarget = e.target as Element
    if (!tapTarget.closest('.remove-btn')) {
      openModal(props.image.src, props.image.name)
    }
    return
  }

  const touch = e.changedTouches[0]
  if (!touch || !store.draggingItem) {
    store.draggingItem = null
    return
  }

  const el = document.elementFromPoint(touch.clientX, touch.clientY)
  const tierItems = el?.closest('[data-tier-id]')
  const poolEl = el?.closest('[data-pool-drop]')

  if (tierItems) {
    const tierId = tierItems.getAttribute('data-tier-id')
    if (tierId) store.moveToTier(tierId, store.draggingItem.imageId)
  } else if (poolEl) {
    store.moveToPool(store.draggingItem.imageId)
  }

  store.draggingItem = null
}

function onRemove(e: MouseEvent) {
  e.stopPropagation()
  store.removeImage(props.image.id)
}

function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  store.removeImage(props.image.id)
}

// Cleanup ghost if component unmounts mid-drag (e.g. applyRemoteState during touch)
onUnmounted(cleanupGhost)
</script>

<template>
  <div
    class="tier-item"
    :class="{ dragging: isDragging }"
    draggable="true"
    @dragstart="onDragStart"
    @dragend="onDragEnd"
    @mousedown="onMouseDown"
    @mouseup="onMouseUp"
    @touchstart.passive="onTouchStart"
    @touchmove.prevent="onTouchMove"
    @touchend="onTouchEnd"
    @contextmenu="onContextMenu"
    :title="image.name || 'Click to preview · Right-click to remove'"
  >
    <img v-if="image.src" :src="image.src" :alt="image.name || 'Image'" loading="lazy" />
    <div v-else class="img-placeholder" />
    <button
      class="remove-btn"
      :aria-label="`Remove ${image.name || 'image'}`"
      @click.stop="onRemove"
      @mousedown.stop
      @mouseup.stop
    >×</button>
  </div>
</template>

<style scoped>
.tier-item {
  width: 100px;
  height: 100px;
  flex-shrink: 0;
  cursor: grab;
  position: relative;
  user-select: none;
  touch-action: none;
}

.tier-item:active {
  cursor: grabbing;
}

.tier-item.dragging {
  opacity: 0.35;
}

.tier-item img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  background: #111;
}

.img-placeholder {
  width: 100%;
  height: 100%;
  background: linear-gradient(110deg, #222 30%, #2e2e2e 50%, #222 70%);
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}

@keyframes shimmer {
  0%   { background-position: 200% center; }
  100% { background-position: -200% center; }
}

.remove-btn {
  display: none;
  position: absolute;
  top: 0;
  right: 0;
  width: 22px;
  height: 22px;
  background: rgba(200, 0, 0, 0.85);
  border: none;
  color: #fff;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  border-radius: 0 0 0 3px;
  padding: 0;
  z-index: 10;
  align-items: center;
  justify-content: center;
}

.tier-item:hover .remove-btn {
  display: flex;
}

.remove-btn:hover {
  background: rgba(220, 0, 0, 1);
}

/* On touch-primary devices (phones/tablets), always show remove button
   since there is no hover state */
@media (hover: none) {
  .remove-btn {
    display: flex;
    opacity: 0.75;
    background: rgba(180, 0, 0, 0.7);
  }
}
</style>
