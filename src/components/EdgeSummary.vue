<script setup lang="ts">
import { computed } from 'vue'

import type {
  TripEdge,
  TripNode,
} from '../types'

const props = defineProps<{
  edge: TripEdge
  nodes: TripNode[]
}>()

const emit = defineEmits<{
  edit: [edgeId: string]
  close: []
}>()

const title = computed(() => {
  const from = props.nodes.find(
    (node) => node.id === props.edge.fromNodeId,
  )

  const to = props.nodes.find(
    (node) => node.id === props.edge.toNodeId,
  )

  return `${from?.name ?? 'Неизвестная точка'} → ${
    to?.name ?? 'Неизвестная точка'
  }`
})

const enabledCount = computed(
  () => props.edge.options.filter((option) => option.enabled).length,
)
</script>

<template>
  <div class="selection-card" role="status">
    <div class="selection-card-text">
      <strong>{{ title }}</strong>
      <span class="muted">
        <template v-if="edge.options.length === 0">
          без вариантов проезда, в расчёте не участвует
        </template>
        <template v-else>
          вариантов: {{ edge.options.length }}, включено: {{ enabledCount }}
        </template>
      </span>
    </div>

    <button
      type="button"
      class="primary small-button"
      @click="emit('edit', edge.id)"
    >
      Редактировать
    </button>

    <button
      type="button"
      class="small-button"
      aria-label="Снять выделение"
      @click="emit('close')"
    >
      ×
    </button>
  </div>
</template>
