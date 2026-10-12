<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import NodeEditor from './NodeEditor.vue'

import type { TripNode } from '../types'

const props = defineProps<{
  open: boolean
  node: TripNode | null
  storageBlocked: boolean
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update-node': [node: TripNode]
  'set-time-zone': [timeZone: string]
  'detect-time-zone': []
  'lookup-place': []
  'set-start': [nodeId: string]
  'set-end': [nodeId: string]
  'delete-node': [nodeId: string]
}>()

const dialog = ref<HTMLDivElement | null>(null)
const closeButton = ref<HTMLButtonElement | null>(null)

const visible = computed(() => props.open && props.node !== null)

let previousFocus: HTMLElement | null = null
let previousBodyOverflow: string | null = null

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
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(deactivateDialog)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && node"
      class="modal-backdrop"
      @click.self="close"
    >
      <div
        ref="dialog"
        class="node-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="node-dialog-title"
        tabindex="-1"
      >
        <header class="node-dialog-header">
          <div>
            <h2 id="node-dialog-title">
              {{ node.name || 'Редактирование точки' }}
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

          <button
            ref="closeButton"
            type="button"
            aria-label="Закрыть редактор точки"
            @click="close"
          >
            Закрыть ×
          </button>
        </header>

        <div class="node-dialog-body">
          <NodeEditor
            :key="node.id"
            :node="node"
            @update:node="emit('update-node', $event)"
            @set-time-zone="emit('set-time-zone', $event)"
            @detect-time-zone="emit('detect-time-zone')"
            @lookup-place="emit('lookup-place')"
            @set-start="emit('set-start', $event)"
            @set-end="emit('set-end', $event)"
            @delete="emit('delete-node', $event)"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.node-dialog {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: calc(100dvh - 48px);
  overflow: hidden;
  border: 1px solid #405574;
  border-radius: 14px;
  background: var(--background);
  box-shadow: 0 24px 80px rgb(0 0 0 / 55%);
}

.node-dialog-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.node-dialog-header h2 {
  margin: 0 0 4px;
}

.node-dialog-header > button {
  flex-shrink: 0;
}

.node-dialog-body {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px;
}

.node-dialog-body :deep(.panel) {
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
}

.node-dialog-body :deep(.panel > h2) {
  display: none;
}

@media (max-width: 640px) {
  .node-dialog {
    max-height: calc(100dvh - 20px);
  }

  .node-dialog-header,
  .node-dialog-body {
    padding: 12px;
  }
}
</style>