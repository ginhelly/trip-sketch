<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { createId } from '../storage'
import {
  GEOCODER_LABELS,
  MAX_ROUTES_LIMIT,
  MIN_ROUTES,
  tileServiceProblem,
} from '../settings'

import type { AppSettings, GeocoderProvider } from '../settings'

const props = defineProps<{
  open: boolean
  settings: AppSettings
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const closeButton = ref<HTMLButtonElement | null>(null)
const backdropPressed = ref(false)

let previousFocus: HTMLElement | null = null

function close(): void {
  emit('update:open', false)
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      previousFocus =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      document.addEventListener('keydown', handleKeydown, true)
      closeButton.value?.focus()
    } else {
      document.removeEventListener('keydown', handleKeydown, true)

      if (previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true })
      }

      previousFocus = null
    }
  },
  { flush: 'post' },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', handleKeydown, true)
})

function addService(): void {
  props.settings.customTileServices.push({
    id: createId(),
    name: '',
    url: '',
    attribution: '',
    maxZoom: 19,
  })
}

function removeService(id: string): void {
  const list = props.settings.customTileServices
  const index = list.findIndex((service) => service.id === id)

  if (index !== -1) list.splice(index, 1)
}

function updateMaxRoutes(event: Event): void {
  const value = (event.target as HTMLInputElement).valueAsNumber

  if (Number.isFinite(value)) {
    props.settings.maxRoutes = Math.min(
      MAX_ROUTES_LIMIT,
      Math.max(MIN_ROUTES, Math.round(value)),
    )
  }
}

function updateGeocoder(event: Event): void {
  const value = (event.target as HTMLSelectElement).value

  if (value === 'photon' || value === 'nominatim') {
    props.settings.geocoder = value satisfies GeocoderProvider
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="modal-backdrop"
      @pointerdown="backdropPressed = $event.target === $event.currentTarget"
      @click.self="backdropPressed && close()"
    >
      <div
        class="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <header class="settings-dialog-header">
          <div>
            <h2 id="settings-dialog-title">Настройки сервиса</h2>
            <div class="muted">
              Хранятся в этом браузере и не попадают в JSON проекта.
            </div>
          </div>

          <button
            ref="closeButton"
            type="button"
            aria-label="Закрыть настройки"
            @click="close"
          >
            Закрыть
          </button>
        </header>

        <div class="settings-dialog-body">
          <section class="settings-section">
            <h3>Тайловые сервисы</h3>

            <p class="muted">
              Свои растровые подложки. Адрес с метками
              <code>{x}</code>, <code>{y}</code>, <code>{z}</code>.
              Готовые сервисы появятся в списке «Подложка» на карте.
              Проверяйте условия использования сервиса.
            </p>

            <div class="tile-service-list">
              <article
                v-for="service in settings.customTileServices"
                :key="service.id"
                class="option-card"
              >
                <div class="opt-head">
                  <input
                    v-model="service.name"
                    class="opt-name"
                    placeholder="Название"
                    aria-label="Название сервиса"
                  />

                  <button
                    type="button"
                    class="icon-button danger"
                    title="Удалить сервис"
                    aria-label="Удалить сервис"
                    @click="removeService(service.id)"
                  >
                    ✕
                  </button>
                </div>

                <input
                  v-model="service.url"
                  class="tile-url"
                  placeholder="https://example.com/{z}/{x}/{y}.png"
                  aria-label="Адрес тайлов"
                />

                <div class="tile-meta">
                  <input
                    v-model="service.attribution"
                    placeholder="Атрибуция, например © автор карты"
                    aria-label="Атрибуция"
                  />

                  <label class="tile-zoom">
                    Макс. масштаб
                    <input
                      v-model.number="service.maxZoom"
                      type="number"
                      min="1"
                      max="24"
                      step="1"
                    />
                  </label>
                </div>

                <p
                  v-if="tileServiceProblem(service)"
                  class="error-text"
                >
                  {{ tileServiceProblem(service) }}
                </p>
              </article>
            </div>

            <button type="button" @click="addService">
              + Добавить сервис
            </button>
          </section>

          <section class="settings-section">
            <h3>Маршруты</h3>

            <label>
              Сколько вариантов маршрута показывать
              <input
                :value="settings.maxRoutes"
                type="number"
                :min="MIN_ROUTES"
                :max="MAX_ROUTES_LIMIT"
                step="1"
                @change="updateMaxRoutes"
              />
            </label>

            <p class="muted">
              От {{ MIN_ROUTES }} до {{ MAX_ROUTES_LIMIT }}, по умолчанию 3.
              Применяется при следующем расчёте.
            </p>
          </section>

          <section class="settings-section">
            <h3>Карта</h3>

            <label class="checkbox-label">
              <input
                v-model="settings.allowNodeDragging"
                type="checkbox"
              />
              Разрешить перетаскивать точки на карте
            </label>
          </section>

          <section class="settings-section">
            <h3>Геокодер</h3>

            <label>
              Поиск мест и определение места по координатам
              <select
                :value="settings.geocoder"
                @change="updateGeocoder"
              >
                <option
                  v-for="(label, id) in GEOCODER_LABELS"
                  :key="id"
                  :value="id"
                >
                  {{ label }}
                </option>
              </select>
            </label>

            <p class="muted">
              Nominatim принимает не больше одного запроса в секунду
              и не любит автодополнение: при быстром наборе возможны
              отказы. Photon для этого подходит лучше.
            </p>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-dialog {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  max-height: calc(100dvh - 48px);
  overflow: hidden;
  border: 1px solid #405574;
  border-radius: 14px;
  background: var(--background);
  box-shadow: 0 24px 80px rgb(0 0 0 / 55%);
}

.settings-dialog-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.settings-dialog-header h2 {
  margin: 0 0 4px;
}

.settings-dialog-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 20px 20px;
}

.settings-section {
  padding: 12px 0;
}

.settings-section + .settings-section {
  border-top: 1px solid var(--border);
}

.settings-section h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.tile-service-list {
  display: grid;
  gap: 10px;
  margin-bottom: 10px;
}

.tile-url {
  margin-top: 8px;
}

.tile-meta {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  margin-top: 8px;
}

.tile-meta > input {
  flex: 1;
}

.tile-zoom {
  flex-shrink: 0;
  width: 120px;
  margin: 0;
}

@media (max-width: 640px) {
  .settings-dialog {
    max-height: calc(100dvh - 20px);
  }

  .tile-meta {
    flex-direction: column;
    align-items: stretch;
  }

  .tile-zoom {
    width: auto;
  }
}
</style>
