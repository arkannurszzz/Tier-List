<script lang="ts">
// Truly module-level (shared across ALL TierRow instances).
// <script setup> variables are per-instance, so draggingTierId would always
// be null on the drop-target rows if declared there — the drag would never work.
let draggingTierId: string | null = null
let dragGhost: HTMLElement | null = null
</script>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from "vue";
import type { TierConfig } from "@/stores/tierStore";
import { useTierStore } from "@/stores/tierStore";
import TierItem from "./TierItem.vue";

const props = defineProps<{
  tier: TierConfig;
  isFirst: boolean;
  isLast: boolean;
}>();

const store = useTierStore();

const isDragOver = ref(false);
const insertIndex = ref<number | null>(null);
const showSettings = ref(false);
const editingLabel = ref(false);
const labelInput = ref("");
const settingsRef = ref<HTMLElement | null>(null);

// ── Tier row drag-to-reorder ───────────────────────────────────────────────
// draggingTierId and dragGhost are declared in the module-level <script> block
// above so they are shared across ALL TierRow instances. Variables declared
// inside <script setup> are per-instance — the drop-target rows would never
// see the dragged tier ID if it were declared here.

const rowDropPosition = ref<'before' | 'after' | null>(null)

function onHandleDragStart(e: DragEvent) {
  draggingTierId = props.tier.id
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // setData is required for Firefox — without it the drag is silently cancelled
    e.dataTransfer.setData('text/plain', props.tier.id)
  }
  // Invisible ghost so the handle doesn't float over the page while dragging;
  // the blue drop-indicator line shows where the row will land instead.
  dragGhost = document.createElement('div')
  dragGhost.style.cssText = 'position:fixed;top:-999px;pointer-events:none'
  document.body.appendChild(dragGhost)
  e.dataTransfer?.setDragImage(dragGhost, 0, 0)
}

function onHandleDragEnd() {
  draggingTierId = null
  rowDropPosition.value = null
  // Clean up in dragend (not requestAnimationFrame) so the ghost element is
  // guaranteed to still be in the DOM when the browser captures the drag image.
  dragGhost?.remove()
  dragGhost = null
}

function onRowDragOver(e: DragEvent) {
  if (!draggingTierId || draggingTierId === props.tier.id) return
  e.preventDefault()
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  rowDropPosition.value = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

function onRowDragLeave(e: DragEvent) {
  if (!draggingTierId) return
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const outside =
    e.clientX < rect.left || e.clientX > rect.right ||
    e.clientY < rect.top  || e.clientY > rect.bottom
  if (outside) rowDropPosition.value = null
}

function onRowDrop(e: DragEvent) {
  if (!draggingTierId || draggingTierId === props.tier.id) return
  e.preventDefault()
  const targetIndex = store.tiers.findIndex(t => t.id === props.tier.id)
  const finalIndex  = rowDropPosition.value === 'after' ? targetIndex + 1 : targetIndex
  store.moveTierTo(draggingTierId, finalIndex)
  draggingTierId = null
  rowDropPosition.value = null
}

// Clear insert indicator when any drag ends
watch(
  () => store.draggingItem,
  (val) => { if (!val) insertIndex.value = null },
);

function onDragOver(e: DragEvent) {
  if (!store.draggingItem) return; // ignore tier-row drags
  e.preventDefault();
  isDragOver.value = true;
}

function onDragLeave(e: DragEvent) {
  // Only trigger if leaving the container itself
  const target = e.currentTarget as HTMLElement;
  if (!target.contains(e.relatedTarget as Node)) {
    isDragOver.value = false;
    insertIndex.value = null;
  }
}

// Per-item hover: compute insert position within the tier
function onItemDragOver(e: DragEvent, index: number) {
  if (!store.draggingItem) return;
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  insertIndex.value = e.clientX < rect.left + rect.width / 2 ? index : index + 1;
}

// Per-item drop: insert at the computed position
function onItemDrop(e: DragEvent) {
  if (!store.draggingItem) return;
  e.stopPropagation(); // prevent outer onDrop from also firing
  const beforeItem =
    insertIndex.value !== null && insertIndex.value < props.tier.items.length
      ? props.tier.items[insertIndex.value]
      : undefined;
  store.moveToTier(props.tier.id, store.draggingItem.imageId, beforeItem?.id);
  insertIndex.value = null;
  isDragOver.value = false;
}

// Container drop: handles drops onto empty space (no item under cursor)
function onDrop(e: DragEvent) {
  e.preventDefault();
  isDragOver.value = false;
  insertIndex.value = null;
  if (!store.draggingItem) return;
  store.moveToTier(props.tier.id, store.draggingItem.imageId);
}

function startEditLabel() {
  labelInput.value = props.tier.label;
  editingLabel.value = true;
}

function saveLabel() {
  const trimmed = labelInput.value.trim();
  if (trimmed) store.updateTierLabel(props.tier.id, trimmed);
  editingLabel.value = false;
}

function toggleSettings() {
  showSettings.value = !showSettings.value;
}

function onColorChange(e: Event) {
  store.updateTierColor(props.tier.id, (e.target as HTMLInputElement).value);
}

function handleClickOutside(e: MouseEvent) {
  if (settingsRef.value && !settingsRef.value.contains(e.target as Node)) {
    showSettings.value = false;
  }
}

onMounted(() => document.addEventListener("mousedown", handleClickOutside));
onUnmounted(() =>
  document.removeEventListener("mousedown", handleClickOutside),
);
</script>

<template>
  <div
    class="tier-row"
    :class="{
      'drop-before': rowDropPosition === 'before',
      'drop-after':  rowDropPosition === 'after',
    }"
    @dragover="onRowDragOver"
    @dragleave="onRowDragLeave"
    @drop="onRowDrop"
  >
    <!-- Drag handle for reordering tier rows -->
    <div
      class="tier-drag-handle"
      draggable="true"
      title="Drag to reorder"
      @dragstart="onHandleDragStart"
      @dragend="onHandleDragEnd"
    >⠿</div>

    <!-- Colored label -->
    <div
      class="tier-label"
      :style="{ backgroundColor: tier.color }"
      @dblclick="startEditLabel"
      title="Double-click to edit label"
    >
      <input
        v-if="editingLabel"
        v-model="labelInput"
        class="label-input"
        maxlength="20"
        autofocus
        :aria-label="`Edit tier label, current: ${tier.label}`"
        @blur="saveLabel"
        @keyup.enter="saveLabel"
        @keyup.escape="editingLabel = false"
        @click.stop
      />
      <span v-else class="label-text">{{ tier.label }}</span>
    </div>

    <!-- Drop zone / Items -->
    <div
      class="tier-items"
      :class="{ 'drag-over': isDragOver && insertIndex === null }"
      :data-tier-id="tier.id"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div
        v-for="(item, index) in tier.items"
        :key="item.id"
        class="tier-item-wrapper"
        :class="{
          'insert-before': insertIndex === index,
          'insert-after': insertIndex === tier.items.length && index === tier.items.length - 1,
        }"
        @dragover.prevent="onItemDragOver($event, index)"
        @drop="onItemDrop($event)"
      >
        <TierItem :image="item" :source="tier.id" />
      </div>
    </div>

    <!-- Controls -->
    <div class="tier-controls">
      <div ref="settingsRef" class="settings-wrapper">
        <button class="control-btn" @click="toggleSettings" aria-label="Tier settings" title="Settings">
          ⚙
        </button>

        <div v-if="showSettings" class="settings-dropdown">
          <label class="color-row">
            <span>Color</span>
            <input type="color" :value="tier.color" @input="onColorChange" />
          </label>
          <button
            @click="
              startEditLabel();
              showSettings = false;
            "
          >
            Rename
          </button>
          <button
            @click="
              store.clearTier(tier.id);
              showSettings = false;
            "
          >
            Clear
          </button>
          <button @click="store.removeTier(tier.id)" class="danger">
            Delete
          </button>
        </div>
      </div>

      <div class="arrows">
        <button
          class="control-btn"
          :disabled="isFirst"
          :aria-label="`Move tier ${tier.label} up`"
          @click="store.moveTierUp(tier.id)"
          title="Move up"
        >
          ▲
        </button>
        <button
          class="control-btn"
          :disabled="isLast"
          :aria-label="`Move tier ${tier.label} down`"
          @click="store.moveTierDown(tier.id)"
          title="Move down"
        >
          ▼
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tier-row {
  display: flex;
  min-height: 114px;
  border-bottom: 1px solid #3a3a3a;
  position: relative;
  transition: border-color 0.1s;
}

.tier-row.drop-before::before,
.tier-row.drop-after::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 3px;
  background: #4af;
  z-index: 10;
  border-radius: 2px;
}

.tier-row.drop-before::before { top: -2px; }
.tier-row.drop-after::after   { bottom: -2px; }

/* Biar sudut atas tetap rounded setelah overflow:hidden dihapus dari container */
.tier-row:first-child .tier-label {
  border-radius: 4px 0 0 0;
}

.tier-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  min-width: 22px;
  background: #1a1a1a;
  border-right: 1px solid #2a2a2a;
  color: #444;
  font-size: 16px;
  cursor: grab;
  user-select: none;
  transition: color 0.15s, background 0.15s;
  letter-spacing: -2px;
}

.tier-drag-handle:hover {
  color: #888;
  background: #222;
}

.tier-drag-handle:active {
  cursor: grabbing;
}

.tier-label {
  width: 140px;
  min-width: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 24px;
  color: #111;
  cursor: pointer;
  text-align: center;
  padding: 8px;
  word-break: break-word;
  line-height: 1.3;
}

.label-text {
  pointer-events: none;
}

.label-input {
  width: 88%;
  background: rgba(0, 0, 0, 0.15);
  border: none;
  border-bottom: 2px solid rgba(0, 0, 0, 0.5);
  text-align: center;
  font-weight: bold;
  font-size: 24px;
  outline: none;
  color: #111;
  padding: 2px;
}

.tier-items {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 7px;
  min-height: 114px;
  align-content: flex-start;
  background: #1c1c1c;
  transition: background 0.15s;
}

.tier-items.drag-over {
  background: #2a2a2a;
  outline: 2px dashed #666;
  outline-offset: -2px;
}

.tier-controls {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 8px;
  background: #242424;
  border-left: 1px solid #3a3a3a;
  min-width: 60px;
}

.control-btn {
  background: none;
  border: none;
  color: #ccc;
  cursor: pointer;
  font-size: 15px;
  padding: 3px 6px;
  border-radius: 3px;
  line-height: 1;
  transition:
    background 0.15s,
    color 0.15s;
}

.control-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}

.control-btn:disabled {
  opacity: 0.25;
  cursor: not-allowed;
}

.arrows {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Per-item wrapper for insert-position indicator */
.tier-item-wrapper {
  position: relative;
  flex-shrink: 0;
}

.tier-item-wrapper.insert-before::before,
.tier-item-wrapper.insert-after::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #4af;
  border-radius: 2px;
  z-index: 20;
}

.tier-item-wrapper.insert-before::before {
  left: -3px;
}

.tier-item-wrapper.insert-after::after {
  right: -3px;
}

.settings-wrapper {
  position: relative;
}

.settings-dropdown {
  position: absolute;
  right: calc(100% + 6px);
  top: 0;
  background: #2e2e2e;
  border: 1px solid #4a4a4a;
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 999;
  min-width: 120px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #ccc;
  cursor: default;
}

.color-row input[type="color"] {
  width: 36px;
  height: 24px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
  background: none;
}

.settings-dropdown button {
  background: #3a3a3a;
  border: 1px solid #555;
  color: #fff;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  transition: background 0.15s;
}

.settings-dropdown button:hover {
  background: #4a4a4a;
}

.settings-dropdown button.danger {
  background: #6b1a1a;
  border-color: #8b2a2a;
}

.settings-dropdown button.danger:hover {
  background: #8b2020;
}
</style>
