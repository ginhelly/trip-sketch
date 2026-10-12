<script setup lang="ts">
import { computed } from 'vue'

import MarkdownNotes from './MarkdownNotes.vue'

import {
  formatDuration,
  resolveZonedDateTime,
  validateTravelOption,
} from '../services'

import type {
  DstDisambiguation,
  TravelOption,
  TripEdge,
  TripNode,
  ZonedDateTimeInput,
} from '../types'

const props = defineProps<{
  option: TravelOption
  edge: TripEdge
  nodes: TripNode[]
}>()

const emit = defineEmits<{
  'update:option': [option: TravelOption]
  duplicate: [option: TravelOption]
  delete: [optionId: string]
}>()

type TimeField = 'departure' | 'arrival'

const timeFields: TimeField[] = ['departure', 'arrival']

const validation = computed(() =>
  validateTravelOption(
    props.edge,
    props.option,
    props.nodes,
  ),
)

const issues = computed(() => {
  const result = validation.value
  return result.ok ? [] : result.issues
})

const duration = computed(() => {
  const departure = resolveZonedDateTime(props.option.departure)
  const arrival = resolveZonedDateTime(props.option.arrival)

  if (
    !departure.ok ||
    !arrival.ok ||
    arrival.value.epochMilliseconds <= departure.value.epochMilliseconds
  ) {
    return '—'
  }

  return formatDuration(
    (arrival.value.epochMilliseconds -
      departure.value.epochMilliseconds) /
      60_000,
  )
})

function updateOption(patch: Partial<TravelOption>): void {
  emit('update:option', {
    ...props.option,
    ...patch,
  })
}

function inputValue(event: Event): string {
  return (
    event.target as
      | HTMLInputElement
      | HTMLTextAreaElement
      | HTMLSelectElement
  ).value
}

function updateName(event: Event): void {
  updateOption({ name: inputValue(event) })
}

function updateEnabled(event: Event): void {
  updateOption({
    enabled: (event.target as HTMLInputElement).checked,
  })
}

function updateCost(event: Event): void {
  const input = event.target as HTMLInputElement

  updateOption({
    cost: input.valueAsNumber,
  })
}

function updateTime(
  field: TimeField,
  patch: Partial<ZonedDateTimeInput>,
): void {
  updateOption({
    [field]: {
      ...props.option[field],
      ...patch,
    },
  })
}

function updateLocalDateTime(
  field: TimeField,
  event: Event,
): void {
  const value = inputValue(event)

  if (field === 'departure' && value) {
    const previous = props.option.departure.localDateTime
    const arrival = props.option.arrival.localDateTime

    // Прибытие подставляется только пока оно пустое или совпадает
    // с прежним отправлением, то есть пользователь его не правил.
    // Дата та же; время пользователь поправит сам.
    if (!arrival || arrival === previous) {
      updateOption({
        departure: { ...props.option.departure, localDateTime: value },
        arrival: { ...props.option.arrival, localDateTime: value },
      })
      return
    }
  }

  updateTime(field, {
    localDateTime: value,
  })
}

function updateTimeZone(
  field: TimeField,
  event: Event,
): void {
  updateTime(field, {
    timeZone: inputValue(event),
  })
}

function updateDisambiguation(
  field: TimeField,
  event: Event,
): void {
  const value = inputValue(event)

  if (
    value !== 'reject' &&
    value !== 'earlier' &&
    value !== 'later'
  ) {
    return
  }

  updateTime(field, {
    disambiguation: value satisfies DstDisambiguation,
  })
}

function timeHint(value: ZonedDateTimeInput): string {
  const result = resolveZonedDateTime(value)

  return result.ok ? `UTC${result.value.offset}` : ''
}

// Выбор смещения показывается, только когда он нужен:
// время неоднозначно или выбор уже сделан.
function needsDisambiguation(field: TimeField): boolean {
  return (
    props.option[field].disambiguation !== 'reject' ||
    issues.value.some(
      (issue) =>
        issue.code === 'ambiguous-date-time' &&
        issue.field?.includes(`.${field}.`),
    )
  )
}
</script>

<template>
  <article
    class="option-card"
    :class="{ 'is-disabled': !option.enabled }"
  >
    <div class="opt-head">
      <input
        type="checkbox"
        :checked="option.enabled"
        title="Использовать в расчёте"
        aria-label="Использовать в расчёте"
        @change="updateEnabled"
      />

      <input
        class="opt-name"
        :value="option.name"
        placeholder="Название, например электричка 07:40"
        aria-label="Название"
        @input="updateName"
      />

      <label class="opt-cost">
        <input
          :value="Number.isFinite(option.cost) ? option.cost : ''"
          type="number"
          min="0"
          step="any"
          aria-label="Стоимость, у.е."
          @input="updateCost"
        />
        <span>у.е.</span>
      </label>

      <button
        type="button"
        class="icon-button"
        title="Дублировать вариант"
        aria-label="Дублировать вариант"
        @click="emit('duplicate', option)"
      >
        ⧉
      </button>

      <button
        type="button"
        class="icon-button danger"
        title="Удалить вариант"
        aria-label="Удалить вариант"
        @click="emit('delete', option.id)"
      >
        ✕
      </button>
    </div>

    <div class="opt-times">
      <div
        v-for="field in timeFields"
        :key="field"
        class="opt-time"
      >
        <div class="opt-time-title">
          {{ field === 'departure' ? 'Отправление' : 'Прибытие' }}
          <span class="muted">{{ timeHint(option[field]) }}</span>
        </div>

        <input
          :value="option[field].localDateTime"
          type="datetime-local"
          step="60"
          :aria-label="
            field === 'departure'
              ? 'Дата и время отправления'
              : 'Дата и время прибытия'
          "
          @input="updateLocalDateTime(field, $event)"
        />

        <input
          :value="option[field].timeZone"
          list="time-zone-list"
          placeholder="Таймзона, например Asia/Yekaterinburg"
          aria-label="Таймзона"
          @input="updateTimeZone(field, $event)"
        />

        <select
          v-if="needsDisambiguation(field)"
          :value="option[field].disambiguation"
          aria-label="Смещение при переводе часов"
          @change="updateDisambiguation(field, $event)"
        >
          <option value="reject">
            Время неоднозначно: выберите смещение
          </option>
          <option value="earlier">
            Раннее смещение
          </option>
          <option value="later">
            Позднее смещение
          </option>
        </select>
      </div>
    </div>

    <div class="opt-meta muted">
      В пути: {{ duration }}
      <template v-if="!option.enabled">
        · исключён из расчёта
      </template>
    </div>

    <MarkdownNotes
      :model-value="option.descriptionMarkdown"
      @update:model-value="updateOption({ descriptionMarkdown: $event })"
    />

    <ul v-if="issues.length" class="error-list">
      <li
        v-for="(issue, index) in issues"
        :key="`${issue.field ?? issue.code}-${index}`"
      >
        {{ issue.message }}
      </li>
    </ul>
  </article>
</template>
