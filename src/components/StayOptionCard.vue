<script setup lang="ts">
import MarkdownNotes from './MarkdownNotes.vue'

import type { StayOption, StayPricing } from '../types'

const props = defineProps<{
  option: StayOption
}>()

const emit = defineEmits<{
  'update:option': [option: StayOption]
  duplicate: [option: StayOption]
  delete: [optionId: string]
}>()

function update(patch: Partial<StayOption>): void {
  emit('update:option', { ...props.option, ...patch })
}

function updatePricing(event: Event): void {
  const value = (event.target as HTMLSelectElement).value

  if (value === 'per-night' || value === 'per-hour') {
    update({ pricing: value satisfies StayPricing })
  }
}

const rateInvalid = (): boolean =>
  !Number.isFinite(props.option.rate) || props.option.rate < 0
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
        title="Учитывать в расчёте"
        aria-label="Учитывать в расчёте"
        @change="update({ enabled: ($event.target as HTMLInputElement).checked })"
      />

      <input
        class="opt-name"
        :value="option.name"
        placeholder="Название, например хостел или камера хранения"
        aria-label="Название"
        @input="update({ name: ($event.target as HTMLInputElement).value })"
      />

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

    <div class="stay-price">
      <label class="opt-cost">
        <input
          :value="Number.isFinite(option.rate) ? option.rate : ''"
          type="number"
          min="0"
          step="any"
          aria-label="Ставка, у.е."
          @input="update({ rate: ($event.target as HTMLInputElement).valueAsNumber })"
        />
        <span>у.е.</span>
      </label>

      <select
        :value="option.pricing"
        aria-label="За что берётся плата"
        @change="updatePricing"
      >
        <option value="per-night">
          за каждую ночь (минимум одни сутки)
        </option>
        <option value="per-hour">
          за каждый час
        </option>
      </select>
    </div>

    <p v-if="rateInvalid()" class="error-text">
      Ставка должна быть неотрицательным числом.
    </p>

    <MarkdownNotes
      :model-value="option.descriptionMarkdown"
      @update:model-value="update({ descriptionMarkdown: $event })"
    />
  </article>
</template>
