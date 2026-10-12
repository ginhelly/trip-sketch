<script setup lang="ts">
import type { TripNode } from '../types'

const props = defineProps<{
  node: TripNode
}>()

const emit = defineEmits<{
  'update:node': [node: TripNode]
  'set-time-zone': [timeZone: string]
  'detect-time-zone': []
  'lookup-place': []
  'set-start': [nodeId: string]
  'set-end': [nodeId: string]
  delete: [nodeId: string]
}>()

function updateName(event: Event): void {
  const name = (event.target as HTMLInputElement).value

  emit('update:node', {
    ...props.node,
    name,
  })
}

function updateTransferMinutes(event: Event): void {
  const input = event.target as HTMLInputElement

  emit('update:node', {
    ...props.node,
    minimumTransferMinutes: input.valueAsNumber,
  })
}

function updateTimeZone(event: Event): void {
  const value = (event.target as HTMLInputElement).value.trim()
  emit('set-time-zone', value)
}
</script>

<template>
  <section class="panel">
    <h2>Точка</h2>

    <label>
      Название
      <input
        :value="node.name"
        @input="updateName"
      />
    </label>

    <div class="muted">
      {{ node.coordinates.lat.toFixed(5) }},
      {{ node.coordinates.lng.toFixed(5) }}
    </div>

    <p
      v-if="node.region || node.country"
      class="muted"
    >
      {{
        [node.region, node.country]
          .filter(Boolean)
          .join(', ')
      }}
    </p>

    <label>
      Таймзона
      <input
        :value="node.timeZone ?? ''"
        list="time-zone-list"
        placeholder="Выберите или введите IANA timezone"
        @change="updateTimeZone"
      />
    </label>

    <button
      type="button"
      class="full-width"
      @click="emit('detect-time-zone')"
    >
      Определить таймзону автоматически
    </button>

    <p class="muted">
      Источник:
      {{
        node.timeZoneSource === 'automatic'
          ? 'по координатам'
          : node.timeZoneSource === 'manual'
            ? 'задана вручную'
            : 'не определена'
      }}
    </p>

    <p v-if="!node.timeZone" class="warning-text">
      Таймзона пока не определена. Дождитесь определения
      или задайте её вручную.
    </p>

    <label>
      Минимальная пересадка, минут
      <input
        :value="
          Number.isFinite(node.minimumTransferMinutes)
            ? node.minimumTransferMinutes
            : ''
        "
        type="number"
        min="0"
        step="1"
        @input="updateTransferMinutes"
      />
    </label>

    <p
      v-if="
        !Number.isFinite(node.minimumTransferMinutes) ||
        node.minimumTransferMinutes < 0
      "
      class="error-text"
    >
      Укажите неотрицательное время пересадки.
      Для пересадки без запаса введите 0.
    </p>

    <div class="button-row">
      <button
        type="button"
        @click="emit('set-start', node.id)"
      >
        Сделать началом
      </button>

      <button
        type="button"
        @click="emit('set-end', node.id)"
      >
        Сделать концом
      </button>
    </div>

    <button
      type="button"
      class="full-width"
      @click="emit('lookup-place')"
    >
      Определить место по координатам
    </button>

    <p class="muted">
      Найденное место может быть ближайшим объектом.
      Координаты точки не изменяются.
    </p>

    <button
      type="button"
      class="danger full-width"
      @click="emit('delete', node.id)"
    >
      Удалить точку
    </button>
  </section>
</template>