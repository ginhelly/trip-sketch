<script setup lang="ts">
import StayOptionCard from './StayOptionCard.vue'

import { LONG_LAYOVER_MINUTES } from '../layover'
import { createId } from '../storage'

import type {
  LayoverMode,
  StayOption,
  TripNode,
} from '../types'

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
}>()

const thresholdHours = LONG_LAYOVER_MINUTES / 60

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

function updateOptions(options: StayOption[]): void {
  emit('update:node', {
    ...props.node,
    layover: { ...props.node.layover, options },
  })
}

function setLayoverMode(mode: LayoverMode): void {
  emit('update:node', {
    ...props.node,
    layover: { ...props.node.layover, mode },
  })
}

function addStay(): void {
  updateOptions([
    ...props.node.layover.options,
    {
      id: createId(),
      name: '',
      descriptionMarkdown: '',
      pricing: 'per-night',
      rate: 0,
      enabled: true,
    },
  ])
}

function updateStay(next: StayOption): void {
  updateOptions(
    props.node.layover.options.map((option) =>
      option.id === next.id ? next : option,
    ),
  )
}

function duplicateStay(option: StayOption): void {
  updateOptions([
    ...props.node.layover.options,
    {
      ...option,
      id: createId(),
      name: option.name ? `${option.name} — копия` : '',
    },
  ])
}

function deleteStay(optionId: string): void {
  updateOptions(
    props.node.layover.options.filter((option) => option.id !== optionId),
  )
}

function hasUsableStay(): boolean {
  return props.node.layover.options.some(
    (option) =>
      option.enabled &&
      Number.isFinite(option.rate) &&
      option.rate >= 0,
  )
}
</script>

<template>
  <section class="panel node-editor">
    <h2>Точка</h2>

    <div class="node-editor-grid">
      <div class="node-editor-main">
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
          <template v-if="node.region || node.country">
            ·
            {{
              [node.region, node.country]
                .filter(Boolean)
                .join(', ')
            }}
          </template>
        </div>

        <label>
          Таймзона
          <span class="inline-field">
            <input
              :value="node.timeZone ?? ''"
              list="time-zone-list"
              placeholder="IANA, например Europe/Moscow"
              @change="updateTimeZone"
            />

            <button
              type="button"
              title="Определить таймзону по координатам"
              @click="emit('detect-time-zone')"
            >
              Авто
            </button>
          </span>
        </label>

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
            Началом маршрута
          </button>

          <button
            type="button"
            @click="emit('set-end', node.id)"
          >
            Концом маршрута
          </button>

          <button
            type="button"
            title="Найденное место может быть ближайшим объектом. Координаты точки не изменяются."
            @click="emit('lookup-place')"
          >
            Определить место
          </button>
        </div>
      </div>

      <div class="node-editor-layover">
        <h3>Пересадка в точке</h3>

        <div class="segmented" role="group" aria-label="Режим пересадки">
          <button
            type="button"
            :class="{ active: node.layover.mode === 'regular' }"
            :aria-pressed="node.layover.mode === 'regular'"
            @click="setLayoverMode('regular')"
          >
            Обычная
          </button>

          <button
            type="button"
            :class="{ active: node.layover.mode === 'extended' }"
            :aria-pressed="node.layover.mode === 'extended'"
            @click="setLayoverMode('extended')"
          >
            Долгая
          </button>
        </div>

        <p v-if="node.layover.mode === 'regular'" class="muted">
          Ожидание в точке бесплатно.
        </p>

        <template v-else>
          <p class="muted">
            Пересадка дольше {{ thresholdHours }} ч считается долгой:
            оплачивается самый дешёвый из вариантов ниже. Время вводить
            не нужно, оно берётся из маршрута.
          </p>

          <button
            type="button"
            class="primary"
            @click="addStay"
          >
            + Вариант проживания или хранения
          </button>

          <p v-if="!hasUsableStay()" class="warning-text">
            Нет включённых вариантов: долгая пересадка будет бесплатной.
          </p>

          <div class="stay-list">
            <StayOptionCard
              v-for="option in node.layover.options"
              :key="option.id"
              :option="option"
              @update:option="updateStay"
              @duplicate="duplicateStay"
              @delete="deleteStay"
            />
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
