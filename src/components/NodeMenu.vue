<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  name: string
  /** Координаты якоря в окне: центр нижнего края точки. */
  x: number
  y: number
  isStart: boolean
  isEnd: boolean
}>()

const emit = defineEmits<{
  start: []
  end: []
  regular: []
  edit: []
  close: []
}>()

const menu = ref<HTMLDivElement | null>(null)
const left = ref(props.x)
const top = ref(props.y)

const MARGIN = 8

function place(): void {
  const element = menu.value
  if (!element) return

  const { width, height } = element.getBoundingClientRect()

  left.value = Math.max(
    MARGIN,
    Math.min(props.x - width / 2, window.innerWidth - width - MARGIN),
  )

  // Не помещается снизу от точки: показываем выше неё.
  top.value =
    props.y + height + MARGIN > window.innerHeight
      ? Math.max(MARGIN, props.y - height - 36)
      : props.y
}

function handlePointerDown(event: PointerEvent): void {
  if (!menu.value?.contains(event.target as Node)) emit('close')
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

onMounted(async () => {
  await nextTick()
  place()
  menu.value?.querySelector('button')?.focus()

  document.addEventListener('pointerdown', handlePointerDown, true)
  document.addEventListener('keydown', handleKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handlePointerDown, true)
  document.removeEventListener('keydown', handleKeydown, true)
})
</script>

<template>
  <div
    ref="menu"
    class="node-menu"
    role="menu"
    :aria-label="`Точка ${name}`"
    :style="{ left: `${left}px`, top: `${top}px` }"
  >
    <div class="node-menu-title">{{ name }}</div>

    <button
      type="button"
      role="menuitemradio"
      :aria-checked="isStart"
      :class="{ active: isStart }"
      @click="emit('start')"
    >
      <span class="node-menu-badge start">A</span>
      Начало маршрута
    </button>

    <button
      type="button"
      role="menuitemradio"
      :aria-checked="isEnd"
      :class="{ active: isEnd }"
      @click="emit('end')"
    >
      <span class="node-menu-badge end">B</span>
      Конец маршрута
    </button>

    <button
      type="button"
      role="menuitemradio"
      :aria-checked="!isStart && !isEnd"
      :class="{ active: !isStart && !isEnd }"
      @click="emit('regular')"
    >
      <span class="node-menu-badge">•</span>
      Обычная точка
    </button>

    <button
      type="button"
      role="menuitem"
      class="node-menu-edit"
      @click="emit('edit')"
    >
      Редактировать…
    </button>
  </div>
</template>

<style scoped>
.node-menu {
  position: fixed;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 210px;
  padding: 8px;
  border: 1px solid #405574;
  border-radius: 10px;
  background: #111c30;
  box-shadow: 0 12px 30px rgb(0 0 0 / 50%);
}

.node-menu-title {
  max-width: 240px;
  overflow: hidden;
  padding: 2px 6px 6px;
  color: var(--muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-menu button {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  text-align: left;
}

.node-menu button.active {
  border-color: #22c55e;
  background: #12332c;
}

.node-menu-edit {
  margin-top: 4px;
}

.node-menu-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #2563eb;
  color: #ffffff;
  font-size: 11px;
  font-weight: 700;
}

.node-menu-badge.start {
  background: #16a34a;
}

.node-menu-badge.end {
  background: #dc2626;
}
</style>
