<script setup lang="ts">
import { computed } from 'vue'

import type { HistoryEntry } from '../composables/useHistory'

const props = defineProps<{
  entries: HistoryEntry[]
  currentIndex: number
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  jump: [index: number]
}>()

// Новые пункты сверху.
const rows = computed(() =>
  props.entries
    .map((entry, index) => ({ entry, index }))
    .reverse(),
)

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString('ru-RU')
}
</script>

<template>
  <section class="panel history-panel">
    <div class="history-toolbar">
      <button
        type="button"
        :disabled="!canUndo"
        title="Отменить (Ctrl+Z)"
        @click="emit('undo')"
      >
        ↶ Отменить
      </button>

      <button
        type="button"
        :disabled="!canRedo"
        title="Повторить (Ctrl+Shift+Z)"
        @click="emit('redo')"
      >
        Повторить ↷
      </button>
    </div>

    <p class="muted">
      Нажмите на пункт, чтобы вернуть состояние на тот момент.
      История хранится только в этой сессии и не попадает в JSON.
      Камера и параметры маршрута в неё не входят.
    </p>

    <ol class="history-list">
      <li
        v-for="{ entry, index } in rows"
        :key="entry.id"
      >
        <button
          type="button"
          class="history-item"
          :class="{
            active: index === currentIndex,
            future: index > currentIndex,
          }"
          :aria-current="index === currentIndex ? 'step' : undefined"
          @click="emit('jump', index)"
        >
          <span class="history-label">{{ entry.label }}</span>
          <span class="history-time muted">
            {{ formatTime(entry.time) }}
          </span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.history-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.history-list {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.history-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 0;
  padding: 6px 10px;
  text-align: left;
  font-size: 12px;
}

.history-item.active {
  border-color: #22c55e;
  background: #12332c;
}

.history-item.future {
  opacity: 0.5;
  border-style: dashed;
}

.history-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.history-time {
  flex-shrink: 0;
  font-size: 11px;
}
</style>
