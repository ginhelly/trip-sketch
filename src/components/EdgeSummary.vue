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
  <section class="panel">
    <h2>{{ title }}</h2>

    <p class="muted">
      Вариантов проезда: {{ edge.options.length }}.
      Включено: {{ enabledCount }}.
    </p>

    <p v-if="edge.options.length === 0" class="muted">
      Связь пока без вариантов проезда и не участвует в расчёте.
    </p>

    <button
      type="button"
      class="primary full-width"
      @click="emit('edit', edge.id)"
    >
      Редактировать варианты проезда
    </button>
  </section>
</template>