<script setup lang="ts">
import { computed } from 'vue'

import type {
  DstDisambiguation,
  OptimizationMode,
  RouteSearchParameters,
  TripNode,
  ZonedDateTimeInput,
} from '../types'

const props = defineProps<{
  parameters: RouteSearchParameters
  nodes: TripNode[]
  maxRoutes: number
}>()

const emit = defineEmits<{
  'update:parameters': [parameters: RouteSearchParameters]
  'start-change': []
  calculate: []
}>()

const blockedReason = computed(() => {
  const p = props.parameters

  if (props.nodes.length === 0) return ''
  if (!p.startNodeId) return 'Выберите начальную точку.'
  if (!p.endNodeId) return 'Выберите конечную точку.'
  if (p.startNodeId === p.endNodeId) {
    return 'Начальная и конечная точки совпадают.'
  }
  if (!p.earliestDeparture.localDateTime) {
    return 'Укажите время, не раньше которого можно отправляться.'
  }
  if (!p.earliestDeparture.timeZone.trim()) {
    return 'Укажите таймзону старта.'
  }

  return ''
})

function inputValue(event: Event): string {
  return (
    event.target as HTMLInputElement | HTMLSelectElement
  ).value
}

function updateParameters(
  patch: Partial<RouteSearchParameters>,
): void {
  emit('update:parameters', {
    ...props.parameters,
    ...patch,
  })
}

function updateStart(event: Event): void {
  updateParameters({
    startNodeId: inputValue(event) || null,
  })

  emit('start-change')
}

function updateEnd(event: Event): void {
  updateParameters({
    endNodeId: inputValue(event) || null,
  })
}

function updateDeparture(
  patch: Partial<ZonedDateTimeInput>,
): void {
  updateParameters({
    earliestDeparture: {
      ...props.parameters.earliestDeparture,
      ...patch,
    },
  })
}

function updateLocalDateTime(event: Event): void {
  updateDeparture({
    localDateTime: inputValue(event),
  })
}

function updateTimeZone(event: Event): void {
  updateDeparture({
    timeZone: inputValue(event),
  })
}

function updateDisambiguation(event: Event): void {
  const value = inputValue(event)

  if (
    value !== 'reject' &&
    value !== 'earlier' &&
    value !== 'later'
  ) {
    return
  }

  const disambiguation: DstDisambiguation = value
  updateDeparture({ disambiguation })
}

function updateOptimization(event: Event): void {
  const value = inputValue(event)

  if (value !== 'cheapest' && value !== 'earliest-arrival') {
    return
  }

  const optimization: OptimizationMode = value
  updateParameters({ optimization })
}
</script>

<template>
  <section class="panel">
    <h2>Маршрут</h2>

    <form @submit.prevent="emit('calculate')">
      <label>
        Начальная точка
        <select
          :value="parameters.startNodeId ?? ''"
          @change="updateStart"
        >
          <option value="">
            Выберите точку
          </option>

          <option
            v-for="node in nodes"
            :key="node.id"
            :value="node.id"
          >
            {{ node.name }}
          </option>
        </select>
      </label>

      <label>
        Конечная точка
        <select
          :value="parameters.endNodeId ?? ''"
          @change="updateEnd"
        >
          <option value="">
            Выберите точку
          </option>

          <option
            v-for="node in nodes"
            :key="node.id"
            :value="node.id"
          >
            {{ node.name }}
          </option>
        </select>
      </label>

      <label>
        Можно отправляться не раньше
        <input
          :value="parameters.earliestDeparture.localDateTime"
          type="datetime-local"
          step="60"
          @input="updateLocalDateTime"
        />
      </label>

      <label>
        Таймзона старта
        <input
          :value="parameters.earliestDeparture.timeZone"
          list="time-zone-list"
          placeholder="Например, Europe/Moscow"
          @input="updateTimeZone"
        />
      </label>

      <details class="advanced-settings">
        <summary>
          Выбор смещения при переводе часов
        </summary>

        <select
          :value="parameters.earliestDeparture.disambiguation"
          @change="updateDisambiguation"
        >
          <option value="reject">
            Запросить при неоднозначности
          </option>
          <option value="earlier">
            Раннее смещение
          </option>
          <option value="later">
            Позднее смещение
          </option>
        </select>
      </details>

      <label>
        Критерий
        <select
          :value="parameters.optimization"
          @change="updateOptimization"
        >
          <option value="cheapest">
            Самые дешёвые — до {{ maxRoutes }} вариантов
          </option>
          <option value="earliest-arrival">
            Самое раннее прибытие — до {{ maxRoutes }} вариантов
          </option>
        </select>
      </label>

      <p v-if="nodes.length === 0" class="muted">
        Сначала добавьте точки на карту или через поиск.
      </p>

      <p v-if="blockedReason" class="disabled-reason">
        {{ blockedReason }}
      </p>

      <button
        type="submit"
        class="primary full-width"
        :disabled="nodes.length === 0 || blockedReason !== ''"
      >
        Рассчитать маршруты
      </button>
    </form>
  </section>
</template>