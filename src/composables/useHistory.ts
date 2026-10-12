import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import {
  cloneSnapshot,
  describeChange,
  patchNode,
  singleNodeAutoChange,
  takeSnapshot,
} from '../history'

import type { HistorySnapshot } from '../history'
import type { TripProject } from '../types'

const MAX_ENTRIES = 200
const COALESCE_MS = 1500
// Автоматические правки точки (адрес, таймзона) приходят с задержкой
// сети, поэтому для неё окно склейки длиннее.
const NODE_COALESCE_MS = 8000
// Сколько после добавления точки автоматические правки сервисов
// (адрес, название, таймзона) вносятся в уже записанные пункты.
const FRESH_NODE_MS = 15000

export interface HistoryEntry {
  id: number
  label: string
  key: string | null
  time: number
  data: HistorySnapshot
  json: string
}

export interface UseHistoryOptions {
  project: Ref<TripProject>
  /** Вызывается после отмены, повтора или перехода к пункту. */
  onRestore?: (entry: HistoryEntry) => void
}

export function useHistory(options: UseHistoryOptions) {
  const { project, onRestore } = options

  let nextId = 1
  let disposed = false

  function createEntry(
    label: string,
    key: string | null,
    data: HistorySnapshot,
  ): HistoryEntry {
    return {
      id: nextId++,
      label,
      key,
      time: Date.now(),
      data,
      json: JSON.stringify(data),
    }
  }

  const entries = shallowRef<HistoryEntry[]>([
    createEntry('Начальное состояние', null, takeSnapshot(project.value)),
  ])

  const currentIndex = ref(0)

  const canUndo = computed(() => currentIndex.value > 0)
  const canRedo = computed(
    () => currentIndex.value < entries.value.length - 1,
  )

  /** Начинает историю заново для нового или импортированного проекта. */
  function reset(): void {
    entries.value = [
      createEntry('Начальное состояние', null, takeSnapshot(project.value)),
    ]
    currentIndex.value = 0
  }

  /**
   * Правку сервиса для только что добавленной точки вносим во все пункты,
   * где эта точка есть, а не создаём новый пункт: иначе отмена вернула бы
   * точку без адреса и таймзоны.
   */
  function foldAutoChange(
    nodeId: string,
    patch: Parameters<typeof patchNode>[2],
    previous: HistorySnapshot,
  ): boolean {
    const list = entries.value
    const now = Date.now()

    let first = currentIndex.value

    while (
      first > 0 &&
      list[first - 1]!.data.nodes.some((node) => node.id === nodeId)
    ) {
      first--
    }

    const before = list[first - 1]

    if (
      !before ||
      !previous.nodes.some((node) => node.id === nodeId) ||
      now - list[first]!.time > FRESH_NODE_MS
    ) {
      return false
    }

    entries.value = list.map((entry, index) => {
      if (index < first) return entry

      const data = patchNode(entry.data, nodeId, patch)

      const updated: HistoryEntry = {
        ...entry,
        data,
        json: JSON.stringify(data),
      }

      if (index === first) {
        updated.label = describeChange(before.data, data).label
      }

      return updated
    })

    return true
  }

  // Пока открыт диалог редактирования, все его правки собираются
  // в один пункт истории.
  let group: { entryId: number | null; fallbackLabel: () => string } | null =
    null

  function beginGroup(fallbackLabel: () => string): void {
    group = { entryId: null, fallbackLabel }
  }

  function endGroup(): void {
    group = null
  }

  function recordGrouped(data: HistorySnapshot, json: string): boolean {
    if (!group) return false

    const list = entries.value
    const last = list.length - 1

    if (group.entryId !== null) {
      const index = list.findIndex((entry) => entry.id === group!.entryId)

      if (index === last && currentIndex.value === last && index > 0) {
        const merged = describeChange(list[index - 1]!.data, data)

        const label = merged.label.includes(' (и ещё изменений')
          ? group.fallbackLabel()
          : merged.label

        const updated: HistoryEntry = {
          ...list[index]!,
          label,
          key: null,
          time: Date.now(),
          data,
          json,
        }

        entries.value = [...list.slice(0, index), updated]
        return true
      }

      // Пункт группы уже не последний (была отмена): начинаем новый.
      group.entryId = null
    }

    const change = describeChange(list[currentIndex.value]!.data, data)
    const kept = list.slice(0, currentIndex.value + 1)
    const entry = createEntry(change.label, null, data)

    kept.push(entry)

    const trimmed =
      kept.length > MAX_ENTRIES ? kept.slice(kept.length - MAX_ENTRIES) : kept

    entries.value = trimmed
    currentIndex.value = trimmed.length - 1
    group.entryId = entry.id

    return true
  }

  function record(): void {
    if (disposed) return

    const list = entries.value
    const current = list[currentIndex.value]!
    const data = takeSnapshot(project.value)
    const json = JSON.stringify(data)

    if (json === current.json) return

    const auto = singleNodeAutoChange(current.data, data)

    if (auto && foldAutoChange(auto.nodeId, auto.patch, current.data)) {
      return
    }

    if (recordGrouped(data, json)) return

    const isLast = currentIndex.value === list.length - 1
    const baseline = currentIndex.value > 0 ? list[currentIndex.value - 1] : null
    const change = describeChange(current.data, data)
    const now = Date.now()

    // Подряд идущие правки одного объекта склеиваем в один пункт.
    // Описание строим от состояния до первой правки пункта.
    if (
      isLast &&
      baseline &&
      change.key !== null &&
      change.key === current.key
    ) {
      const windowMs = change.key.startsWith('node:')
        ? NODE_COALESCE_MS
        : COALESCE_MS

      if (now - current.time < windowMs) {
        const merged = describeChange(baseline.data, data)

        const updated: HistoryEntry = {
          ...current,
          label: merged.label,
          key: merged.key ?? current.key,
          time: now,
          data,
          json,
        }

        entries.value = [...list.slice(0, currentIndex.value), updated]
        return
      }
    }

    const kept = list.slice(0, currentIndex.value + 1)
    kept.push(createEntry(change.label, change.key, data))

    const trimmed =
      kept.length > MAX_ENTRIES ? kept.slice(kept.length - MAX_ENTRIES) : kept

    entries.value = trimmed
    currentIndex.value = trimmed.length - 1
  }

  function restore(index: number): void {
    const entry = entries.value[index]
    if (!entry) return

    const snapshot = cloneSnapshot(entry.data)

    currentIndex.value = index

    // Поля меняются по отдельности, сам объект проекта не заменяется:
    // от его идентичности зависят другие части приложения.
    project.value.name = snapshot.name
    project.value.nodes = snapshot.nodes
    project.value.edges = snapshot.edges

    const nodeIds = new Set(snapshot.nodes.map((node) => node.id))
    const search = project.value.routeSearch

    if (search.startNodeId && !nodeIds.has(search.startNodeId)) {
      search.startNodeId = null
    }

    if (search.endNodeId && !nodeIds.has(search.endNodeId)) {
      search.endNodeId = null
    }

    onRestore?.(entry)
  }

  function undo(): void {
    if (canUndo.value) restore(currentIndex.value - 1)
  }

  function redo(): void {
    if (canRedo.value) restore(currentIndex.value + 1)
  }

  function jumpTo(index: number): void {
    if (index !== currentIndex.value) restore(index)
  }

  const stopWatching = watch(
    () => [project.value.name, project.value.nodes, project.value.edges],
    record,
    { deep: true, flush: 'post' },
  )

  function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false

    return (
      target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    )
  }

  // В полях ввода остаётся обычная отмена набора текста.
  function handleKeydown(event: KeyboardEvent): void {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return
    if (isEditable(event.target)) return

    const key = event.key.toLowerCase()

    if (key === 'z' && !event.shiftKey) {
      event.preventDefault()
      undo()
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault()
      redo()
    }
  }

  window.addEventListener('keydown', handleKeydown)

  onScopeDispose(() => {
    disposed = true
    stopWatching()
    window.removeEventListener('keydown', handleKeydown)
  })

  return {
    entries,
    currentIndex,
    canUndo,
    canRedo,
    undo,
    redo,
    jumpTo,
    reset,
    beginGroup,
    endGroup,
  }
}
