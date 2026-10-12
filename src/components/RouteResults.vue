<script setup lang="ts">
import { computed } from 'vue'

import {
  formatDuration,
  formatResolvedDateTime,
} from '../services'

import type {
  FoundRoute,
  RouteCalculationResult,
  StayCharge,
  TripNode,
} from '../types'

const props = defineProps<{
  result: RouteCalculationResult | null
  stale: boolean
  nodes: TripNode[]
  selectedIndex: number
}>()

const emit = defineEmits<{
  'update:selectedIndex': [index: number]
  'open-edge': [edgeId: string]
  recalculate: []
}>()

const nodeNames = computed(
  () => new Map(props.nodes.map((node) => [node.id, node.name])),
)

const routes = computed<FoundRoute[]>(() =>
  props.result?.status === 'found' ? props.result.routes : [],
)

const activeRoute = computed<FoundRoute | null>(
  () => routes.value[props.selectedIndex] ?? routes.value[0] ?? null,
)

const activeIndex = computed(() =>
  routes.value[props.selectedIndex] ? props.selectedIndex : 0,
)

const diagnostics = computed(() => {
  const result = props.result

  return result && result.status !== 'invalid-request'
    ? result.diagnostics
    : null
})

function nodeName(nodeId: string): string {
  return nodeNames.value.get(nodeId) ?? 'Удалённая или неизвестная точка'
}

function routePath(route: FoundRoute): string {
  return [
    nodeName(route.startNodeId),
    ...route.legs.map((leg) => nodeName(leg.toNodeId)),
  ].join(' → ')
}

function stayText(stay: StayCharge): string {
  const units =
    stay.pricing === 'per-night'
      ? `${stay.units} ноч.`
      : `${stay.units} ч`

  return `${stay.optionName || 'Вариант без названия'}, ${units}`
}

function formatCost(cost: number): string {
  return `${cost.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
  })} у.е.`
}
</script>

<template>
  <section
    v-if="result"
    class="panel route-result"
    :class="{ 'is-stale': stale }"
    aria-live="polite"
  >
    <div class="results-heading">
      <h2>Результаты</h2>

      <span v-if="result.status === 'found'" class="muted">
        Найдено: {{ routes.length }}
      </span>
    </div>

    <div v-if="stale" class="stale-notice">
      <p class="warning-text">
        Данные изменились. Эти результаты устарели
        и не подсвечиваются на карте.
      </p>

      <button
        type="button"
        class="full-width"
        @click="emit('recalculate')"
      >
        Пересчитать
      </button>
    </div>

    <template v-if="result.status === 'invalid-request'">
      <ul class="error-list">
        <li
          v-for="(issue, index) in result.issues"
          :key="`${issue.field ?? issue.code}-${index}`"
        >
          {{ issue.message }}
        </li>
      </ul>
    </template>

    <template v-else-if="result.status === 'not-found'">
      <p>{{ result.message }}</p>
    </template>

    <template v-else>
      <p class="muted">
        {{
          result.optimization === 'cheapest'
            ? 'По стоимости, затем по времени прибытия и числу переездов.'
            : 'По времени прибытия, затем по стоимости и числу переездов.'
        }}
      </p>

      <div class="route-choices" aria-label="Выбор маршрута">
        <button
          v-for="(route, index) in routes"
          :key="index"
          type="button"
          class="route-choice"
          :class="{ active: activeIndex === index }"
          :aria-pressed="activeIndex === index"
          @click="emit('update:selectedIndex', index)"
        >
          <span class="route-choice-heading">
            <span>Вариант {{ index + 1 }}</span>
            <span>{{ formatCost(route.summary.totalCost) }}</span>
          </span>

          <span class="route-choice-path">
            {{ routePath(route) }}
          </span>

          <span class="route-choice-info">
            {{ formatDuration(route.summary.totalDurationMinutes) }}
            от заданного старта ·
            переездов: {{ route.summary.legCount }}
          </span>

          <span class="route-choice-info">
            Прибытие: {{ formatResolvedDateTime(route.arrival) }}
          </span>
        </button>
      </div>

      <p v-if="routes.length === 0" class="warning-text">
        Расчёт вернул пустой список маршрутов.
      </p>

      <template v-if="activeRoute">
        <h3 class="route-detail-title">
          Вариант {{ activeIndex + 1 }} — подробно
        </h3>

        <div class="route-summary">
          <div>
            Стоимость:
            {{ formatCost(activeRoute.summary.totalCost) }}
          </div>

          <div>
            От заданного старта:
            {{ formatDuration(activeRoute.summary.totalDurationMinutes) }}
          </div>

          <div>
            В движении:
            {{ formatDuration(activeRoute.summary.totalTravelMinutes) }}
          </div>

          <div>
            Ожидание:
            {{ formatDuration(activeRoute.summary.totalWaitingMinutes) }}
          </div>

          <div>
            Переездов: {{ activeRoute.summary.legCount }}
          </div>
        </div>

        <p class="muted">
          Начало отсчёта:
          {{ formatResolvedDateTime(activeRoute.requestedDeparture) }}
          <br />
          Прибытие:
          {{ formatResolvedDateTime(activeRoute.arrival) }}
        </p>

        <p v-if="activeRoute.legs.length === 0">
          Начало и конец совпадают — ехать не требуется.
        </p>

        <article
          v-for="(leg, index) in activeRoute.legs"
          :key="`${leg.edgeId}-${leg.optionId}-${index}`"
          class="route-leg"
        >
          <button
            type="button"
            class="link-button"
            @click="emit('open-edge', leg.edgeId)"
          >
            {{ index + 1 }}.
            {{ nodeName(leg.fromNodeId) }}
            → {{ nodeName(leg.toNodeId) }}
          </button>

          <div v-if="leg.stayBefore" class="muted">
            Пребывание в {{ nodeName(leg.fromNodeId) }}
            ({{ formatDuration(leg.stayBefore.minutes) }}):
            {{ stayText(leg.stayBefore) }},
            {{ formatCost(leg.stayBefore.cost) }}
          </div>

          <div>{{ leg.optionName }}</div>
          <div>{{ formatCost(leg.cost) }}</div>

          <p class="muted">
            Отправление:
            {{ formatResolvedDateTime(leg.departure) }}
            <br />
            Прибытие:
            {{ formatResolvedDateTime(leg.arrival) }}
          </p>

          <div class="muted">
            В пути: {{ formatDuration(leg.travelMinutes) }}.
            Ожидание перед рейсом:
            {{ formatDuration(leg.waitingBeforeMinutes) }}.
          </div>
        </article>
      </template>
    </template>

    <details
      v-if="diagnostics"
      class="advanced-settings"
    >
      <summary>Диагностика вариантов проезда</summary>

      <p class="muted">
        Всего: {{ diagnostics.totalOptions }}.
        Корректных включённых: {{ diagnostics.usableOptions }}.
        Отключённых: {{ diagnostics.disabledOptions }}.
        Некорректных: {{ diagnostics.invalidOptions }}.
      </p>

      <div
        v-for="item in diagnostics.issues"
        :key="`${item.edgeId}-${item.optionId}`"
        class="diagnostic-item"
      >
        <button
          type="button"
          class="link-button"
          @click="emit('open-edge', item.edgeId)"
        >
          Открыть проблемную связь
        </button>

        <ul class="error-list">
          <li
            v-for="(issue, index) in item.issues"
            :key="index"
          >
            {{ issue.message }}
          </li>
        </ul>
      </div>
    </details>
  </section>
</template>

<style scoped>
.results-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.results-heading h2 {
  margin-bottom: 0;
}

.stale-notice {
  margin: 12px 0;
}

.route-choices {
  display: grid;
  gap: 8px;
  margin: 14px 0;
}

.route-choice {
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  padding: 12px;
  text-align: left;
}

.route-choice.active {
  border-color: #22c55e;
  background: #12332c;
}

.route-choice-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 6px 12px;
  font-weight: 600;
}

.route-choice-path {
  color: #e2e8f0;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.route-choice-info {
  color: #b4c4d9;
  font-size: 11px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.route-detail-title {
  margin: 18px 0 12px;
  color: #e2e8f0;
  font-size: 14px;
  font-weight: 600;
}

.diagnostic-item + .diagnostic-item {
  margin-top: 12px;
}
</style>