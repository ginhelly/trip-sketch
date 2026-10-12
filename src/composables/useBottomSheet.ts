import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { Ref } from 'vue'

export type SheetSnap = 'collapsed' | 'half' | 'full'

const MOBILE_QUERY = '(max-width: 760px)'
const COLLAPSED_HEIGHT = 76
const TAP_DISTANCE = 6
// Насколько вперёд по скорости «бросок» сдвигает целевую высоту.
const FLING_MS = 180

/**
 * Нижняя панель для телефонов: тянется за ручку между тремя положениями
 * (свёрнута, наполовину, на всю область) и фиксируется у ближайшего.
 */
export function useBottomSheet(container: Ref<HTMLElement | null>) {
  const isMobile = ref(false)
  const containerHeight = ref(0)
  const snap = ref<SheetSnap>('half')
  const dragHeight = ref<number | null>(null)

  const snapHeights = computed<Record<SheetSnap, number>>(() => ({
    collapsed: COLLAPSED_HEIGHT,
    half: Math.round(containerHeight.value * 0.5),
    full: containerHeight.value,
  }))

  const height = computed(() => dragHeight.value ?? snapHeights.value[snap.value])
  const dragging = computed(() => dragHeight.value !== null)

  const sheetStyle = computed(() =>
    isMobile.value && containerHeight.value > 0
      ? { height: `${height.value}px` }
      : undefined,
  )

  // Отступ для элементов карты, чтобы панель их не закрывала.
  const containerStyle = computed(() => ({
    '--sheet-offset': isMobile.value ? `${Math.round(height.value)}px` : '0px',
  }))

  let mediaQuery: MediaQueryList | null = null
  let observer: ResizeObserver | null = null

  function updateMobile(): void {
    isMobile.value = mediaQuery?.matches ?? false
  }

  onMounted(() => {
    mediaQuery = window.matchMedia(MOBILE_QUERY)
    updateMobile()
    mediaQuery.addEventListener('change', updateMobile)

    if (container.value) {
      containerHeight.value = container.value.clientHeight

      observer = new ResizeObserver(() => {
        containerHeight.value = container.value?.clientHeight ?? 0
      })

      observer.observe(container.value)
    }
  })

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', updateMobile)
    observer?.disconnect()
  })

  let startY = 0
  let startHeight = 0
  let lastY = 0
  let lastTime = 0
  let velocity = 0
  let moved = false

  function clamp(value: number): number {
    return Math.min(
      snapHeights.value.full,
      Math.max(snapHeights.value.collapsed, value),
    )
  }

  function nearest(target: number): SheetSnap {
    const entries = Object.entries(snapHeights.value) as Array<
      [SheetSnap, number]
    >

    return entries.reduce((best, item) =>
      Math.abs(item[1] - target) < Math.abs(best[1] - target) ? item : best,
    )[0]
  }

  function cycle(): void {
    snap.value =
      snap.value === 'collapsed'
        ? 'half'
        : snap.value === 'half'
          ? 'full'
          : 'half'
  }

  function onHandlePointerDown(event: PointerEvent): void {
    if (!isMobile.value) return

    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)

    startY = event.clientY
    lastY = event.clientY
    lastTime = event.timeStamp
    startHeight = height.value
    velocity = 0
    moved = false
  }

  function onHandlePointerMove(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement

    if (!target.hasPointerCapture(event.pointerId)) return

    if (Math.abs(event.clientY - startY) > TAP_DISTANCE) moved = true
    if (!moved) return

    const elapsed = event.timeStamp - lastTime

    if (elapsed > 0) {
      // Скорость вверх положительна: панель растёт.
      velocity = (lastY - event.clientY) / elapsed
    }

    lastY = event.clientY
    lastTime = event.timeStamp
    dragHeight.value = clamp(startHeight + (startY - event.clientY))
  }

  function finishDrag(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement

    if (!target.hasPointerCapture(event.pointerId)) return

    target.releasePointerCapture(event.pointerId)

    if (!moved) {
      cycle()
    } else if (dragHeight.value !== null) {
      snap.value = nearest(dragHeight.value + velocity * FLING_MS)
    }

    dragHeight.value = null
  }

  function onHandleKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      snap.value = snap.value === 'collapsed' ? 'half' : 'full'
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      snap.value = snap.value === 'full' ? 'half' : 'collapsed'
    }
  }

  return {
    isMobile,
    snap,
    dragging,
    sheetStyle,
    containerStyle,
    onHandlePointerDown,
    onHandlePointerMove,
    onHandlePointerUp: finishDrag,
    onHandlePointerCancel: finishDrag,
    onHandleKeydown,
  }
}
