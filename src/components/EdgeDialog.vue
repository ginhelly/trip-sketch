<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import TravelOptionCard from './TravelOptionCard.vue'

import type {
  TravelOption,
  TripEdge,
  TripNode,
} from '../types'

const props = defineProps<{
  open: boolean
  edge: TripEdge | null
  nodes: TripNode[]
  storageBlocked: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'add-option': []
  'update-option': [option: TravelOption]
  'duplicate-option': [option: TravelOption]
  'delete-option': [optionId: string]
  'delete-edge': []
}>()

const dialog = ref<HTMLDivElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

let previousFocus: HTMLElement | null = null
let previousBodyOverflow: string | null = null

const visible = computed(() => props.open && props.edge !== null)

const title = computed(() => {
  const edge = props.edge
  if (!edge) return ''

  const from = props.nodes.find(
    (node) => node.id === edge.fromNodeId,
  )

  const to = props.nodes.find(
    (node) => node.id === edge.toNodeId,
  )

  return `${from?.name ?? 'Неизвестная точка'} → ${
    to?.name ?? 'Неизвестная точка'
  }`
})

// Закрываем по клику на фон, только если нажатие тоже началось на фоне:
// выделение текста в поле с выходом курсора за диалог не должно его закрывать.
const backdropPressed = ref(false)

function close(): void {
  emit('update:open', false)
}

function focusableElements(): HTMLElement[] {
  const root = dialog.value
  if (!root) return []

  const selector = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'summary',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  return Array.from(
    root.querySelectorAll<HTMLElement>(selector),
  ).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest('[inert]'),
  )
}

function handleKeydown(event: KeyboardEvent): void {
  if (!visible.value) return

  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
    return
  }

  if (event.key !== 'Tab') return

  const root = dialog.value
  if (!root) return

  const elements = focusableElements()

  if (elements.length === 0) {
    event.preventDefault()
    root.focus()
    return
  }

  const first = elements[0]!
  const last = elements[elements.length - 1]!
  const active = document.activeElement
  const outside = !active || !root.contains(active)

  if (event.shiftKey) {
    if (active === first || active === root || outside) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last || active === root || outside) {
    event.preventDefault()
    first.focus()
  }
}

function activateDialog(): void {
  previousFocus =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  previousBodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'

  document.addEventListener('keydown', handleKeydown, true)

  closeButton.value?.focus()
}

function deactivateDialog(): void {
  document.removeEventListener('keydown', handleKeydown, true)

  if (previousBodyOverflow !== null) {
    document.body.style.overflow = previousBodyOverflow
    previousBodyOverflow = null
  }

  const target = previousFocus
  previousFocus = null

  if (target?.isConnected) {
    target.focus({ preventScroll: true })
  }
}

watch(
  visible,
  (isVisible) => {
    if (isVisible) {
      activateDialog()
    } else {
      deactivateDialog()
    }
  },
  {
    immediate: true,
    flush: 'post',
  },
)

onBeforeUnmount(deactivateDialog)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && edge"
      class="modal-backdrop"
      @pointerdown="backdropPressed = $event.target === $event.currentTarget"
      @click.self="backdropPressed && close()"
    >
      <div
        ref="dialog"
        class="edge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edge-dialog-title"
        tabindex="-1"
      >
        <header class="edge-dialog-header">
          <div>
            <h2 id="edge-dialog-title">
              {{ title }}
            </h2>

            <div
              :class="storageBlocked ? 'warning-text' : 'muted'"
            >
              {{
                storageBlocked
                  ? 'Автосохранение заблокировано'
                  : 'Изменения сохраняются автоматически'
              }}
            </div>
          </div>

          <div class="edge-dialog-actions">
            <button
              type="button"
              class="icon-button danger"
              title="Удалить связь целиком"
              aria-label="Удалить связь целиком"
              @click="emit('delete-edge')"
            >
              ✕ Связь
            </button>

            <button
              ref="closeButton"
              type="button"
              aria-label="Закрыть редактор связи"
              @click="close"
            >
              Закрыть
            </button>
          </div>
        </header>

        <div class="edge-dialog-body">
          <section class="panel">
            <div class="edge-toolbar">
              <p class="muted">
                Только это направление. Обратная связь создаётся отдельно.
                <template v-if="edge.options.length === 0">
                  Пока нет вариантов, пустая связь не участвует в расчёте.
                </template>
              </p>

              <button
                type="button"
                class="primary"
                @click="emit('add-option')"
              >
                + Вариант проезда
              </button>
            </div>

            <div class="option-grid">
              <TravelOptionCard
                v-for="option in edge.options"
                :key="option.id"
                :option="option"
                :edge="edge"
                :nodes="nodes"
                @update:option="emit('update-option', $event)"
                @duplicate="emit('duplicate-option', $event)"
                @delete="emit('delete-option', $event)"
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  </Teleport>
</template>