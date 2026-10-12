<script setup lang="ts">
import { computed } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

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

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const defaultLinkRenderer = markdown.renderer.rules.link_open

markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  env,
  renderer,
) => {
  const token = tokens[index]

  if (token) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }

  return defaultLinkRenderer
    ? defaultLinkRenderer(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}

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

const previewHtml = computed(() =>
  DOMPurify.sanitize(
    markdown.render(props.option.descriptionMarkdown),
    {
      ADD_ATTR: ['target', 'rel'],
    },
  ),
)

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

function updateDescription(event: Event): void {
  updateOption({ descriptionMarkdown: inputValue(event) })
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
  updateTime(field, {
    localDateTime: inputValue(event),
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

  return result.ok
    ? `UTC${result.value.offset} · ${result.value.instantIso}`
    : result.issues.map((issue) => issue.message).join(' ')
}
</script>

<template>
  <article
    class="option-card"
    :class="{ 'is-disabled': !option.enabled }"
  >
    <div class="option-card-header">
      <label class="checkbox-label">
        <input
          type="checkbox"
          :checked="option.enabled"
          @change="updateEnabled"
        />
        Использовать в расчёте
      </label>

      <button
        type="button"
        class="small-button"
        title="Дублировать вариант проезда"
        @click="emit('duplicate', option)"
      >
        Копия
      </button>
    </div>

    <label>
      Название
      <input
        :value="option.name"
        placeholder="Например, электричка 07:40"
        @input="updateName"
      />
    </label>

    <label>
      Стоимость, у.е.
      <input
        :value="Number.isFinite(option.cost) ? option.cost : ''"
        type="number"
        min="0"
        step="any"
        @input="updateCost"
      />
    </label>

    <fieldset
      v-for="field in timeFields"
      :key="field"
      class="time-fieldset"
    >
      <legend>
        {{ field === 'departure' ? 'Отправление' : 'Прибытие' }}
      </legend>

      <label>
        Дата и местное время
        <input
          :value="option[field].localDateTime"
          type="datetime-local"
          step="60"
          @input="updateLocalDateTime(field, $event)"
        />
      </label>

      <label>
        Таймзона
        <input
          :value="option[field].timeZone"
          list="time-zone-list"
          placeholder="Например, Asia/Yekaterinburg"
          @input="updateTimeZone(field, $event)"
        />
      </label>

      <details class="advanced-settings">
        <summary>
          Смещение при переводе часов
        </summary>

        <select
          :value="option[field].disambiguation"
          @change="updateDisambiguation(field, $event)"
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

      <div class="muted time-hint">
        {{ timeHint(option[field]) }}
      </div>
    </fieldset>

    <div class="muted">
      Продолжительность: {{ duration }}
    </div>

    <label>
      Заметки и ссылки — Markdown
      <textarea
        :value="option.descriptionMarkdown"
        rows="5"
        placeholder="[Билеты](https://...)"
        @input="updateDescription"
      />
    </label>

    <details
      v-if="option.descriptionMarkdown"
      class="advanced-settings"
    >
      <summary>
        Предпросмотр заметок
      </summary>

      <div
        class="markdown-content"
        v-html="previewHtml"
      />
    </details>

    <p v-if="!option.enabled" class="muted">
      Этот вариант сохранён, но исключён из расчёта.
    </p>

    <ul v-if="issues.length" class="error-list">
      <li
        v-for="(issue, index) in issues"
        :key="`${issue.field ?? issue.code}-${index}`"
      >
        {{ issue.message }}
      </li>
    </ul>

    <button
      type="button"
      class="danger full-width"
      @click="emit('delete', option.id)"
    >
      Удалить вариант
    </button>
  </article>
</template>