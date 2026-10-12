import type {
  TravelOption,
  TripEdge,
  TripNode,
  TripProject,
} from './types'

/**
 * Часть проекта, которая попадает в историю правок.
 * Камера, подложка и параметры поиска маршрута в неё не входят.
 */
export interface HistorySnapshot {
  name: string
  nodes: TripNode[]
  edges: TripEdge[]
}

export interface HistoryChange {
  label: string
  /**
   * Одинаковый ключ у подряд идущих правок позволяет склеить их
   * в один пункт (набор текста, перетаскивание). null — не склеивать.
   */
  key: string | null
}

export function takeSnapshot(
  project: Pick<TripProject, 'name' | 'nodes' | 'edges'>,
): HistorySnapshot {
  return JSON.parse(
    JSON.stringify({
      name: project.name,
      nodes: project.nodes,
      edges: project.edges,
    }),
  ) as HistorySnapshot
}

export function cloneSnapshot(snapshot: HistorySnapshot): HistorySnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as HistorySnapshot
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

type NodeCategory =
  | 'move'
  | 'rename'
  | 'time-zone'
  | 'place'
  | 'transfer'
  | 'layover-mode'
  | 'stay'

function nodeCategories(prev: TripNode, next: TripNode): NodeCategory[] {
  const result: NodeCategory[] = []

  if (!same(prev.coordinates, next.coordinates)) result.push('move')
  if (prev.name !== next.name) result.push('rename')

  if (
    prev.timeZone !== next.timeZone ||
    prev.timeZoneSource !== next.timeZoneSource
  ) {
    result.push('time-zone')
  }

  if (prev.region !== next.region || prev.country !== next.country) {
    result.push('place')
  }

  if (prev.minimumTransferMinutes !== next.minimumTransferMinutes) {
    result.push('transfer')
  }

  if (prev.layover.mode !== next.layover.mode) result.push('layover-mode')
  if (!same(prev.layover.options, next.layover.options)) result.push('stay')

  return result
}

function describeNodeChange(
  prev: TripNode,
  next: TripNode,
): HistoryChange | null {
  const categories = nodeCategories(prev, next)

  if (categories.length === 0) return null

  const name = `«${next.name}»`
  const nodeKey = `node:${next.id}`

  if (categories.length > 1) {
    return { label: `Изменена точка ${name}`, key: nodeKey }
  }

  switch (categories[0]) {
    case 'move':
      return {
        label: `Перемещена точка ${name}`,
        key: `move:${next.id}`,
      }
    case 'rename':
      return {
        label: `Переименована точка «${prev.name}» → ${name}`,
        key: nodeKey,
      }
    case 'time-zone':
      return {
        label: `Таймзона точки ${name}: ${next.timeZone ?? 'не задана'}`,
        key: nodeKey,
      }
    case 'place':
      return { label: `Уточнено место точки ${name}`, key: nodeKey }
    case 'transfer':
      return {
        label: `Минимальная пересадка в ${name}: ${next.minimumTransferMinutes} мин`,
        key: nodeKey,
      }
    case 'layover-mode':
      return {
        label: `Пересадка в ${name}: ${
          next.layover.mode === 'extended' ? 'долгая' : 'обычная'
        }`,
        key: nodeKey,
      }
    default:
      return describeStayChange(prev, next)
  }
}

function describeStayChange(
  prev: TripNode,
  next: TripNode,
): HistoryChange {
  const name = `«${next.name}»`
  const before = new Map(prev.layover.options.map((item) => [item.id, item]))
  const after = new Map(next.layover.options.map((item) => [item.id, item]))

  const added = next.layover.options.filter((item) => !before.has(item.id))
  const removed = prev.layover.options.filter((item) => !after.has(item.id))

  if (added.length > 0 && removed.length === 0) {
    return {
      label: `Добавлен вариант проживания в ${name}`,
      key: null,
    }
  }

  if (removed.length > 0 && added.length === 0) {
    return {
      label: `Удалён вариант проживания «${removed[0]!.name || 'без названия'}» в ${name}`,
      key: null,
    }
  }

  const changed = next.layover.options.find(
    (item) => before.has(item.id) && !same(before.get(item.id), item),
  )

  return {
    label: `Изменён вариант проживания в ${name}`,
    key: changed ? `stay:${changed.id}` : null,
  }
}

function optionTitle(option: TravelOption): string {
  return option.name.trim() ? `«${option.name}»` : 'без названия'
}

/** Описывает, что изменилось между двумя снимками. */
export function describeChange(
  prev: HistorySnapshot,
  next: HistorySnapshot,
): HistoryChange {
  const changes: HistoryChange[] = []

  const prevNodes = new Map(prev.nodes.map((node) => [node.id, node]))
  const nextNodes = new Map(next.nodes.map((node) => [node.id, node]))

  const nodeName = (id: string): string =>
    nextNodes.get(id)?.name ?? prevNodes.get(id)?.name ?? '?'

  const edgeTitle = (edge: TripEdge): string =>
    `${nodeName(edge.fromNodeId)} → ${nodeName(edge.toNodeId)}`

  if (prev.name !== next.name) {
    changes.push({
      label: `Название проекта: «${next.name}»`,
      key: 'project-name',
    })
  }

  const addedNodes = next.nodes.filter((node) => !prevNodes.has(node.id))
  const removedNodes = prev.nodes.filter((node) => !nextNodes.has(node.id))
  const removedNodeIds = new Set(removedNodes.map((node) => node.id))

  if (addedNodes.length === 1) {
    changes.push({
      label: `Добавлена точка «${addedNodes[0]!.name}»`,
      key: `node:${addedNodes[0]!.id}`,
    })
  } else if (addedNodes.length > 1) {
    changes.push({
      label: `Добавлено точек: ${addedNodes.length}`,
      key: null,
    })
  }

  const nextEdges = new Map(next.edges.map((edge) => [edge.id, edge]))
  const prevEdges = new Map(prev.edges.map((edge) => [edge.id, edge]))

  const removedEdges = prev.edges.filter((edge) => !nextEdges.has(edge.id))

  const cascadeEdges = removedEdges.filter(
    (edge) =>
      removedNodeIds.has(edge.fromNodeId) ||
      removedNodeIds.has(edge.toNodeId),
  )

  if (removedNodes.length === 1) {
    changes.push({
      label:
        `Удалена точка «${removedNodes[0]!.name}»` +
        (cascadeEdges.length > 0
          ? ` и связей: ${cascadeEdges.length}`
          : ''),
      key: null,
    })
  } else if (removedNodes.length > 1) {
    changes.push({
      label: `Удалено точек: ${removedNodes.length}`,
      key: null,
    })
  }

  for (const node of next.nodes) {
    const before = prevNodes.get(node.id)
    if (!before) continue

    const change = describeNodeChange(before, node)
    if (change) changes.push(change)
  }

  for (const edge of next.edges) {
    const before = prevEdges.get(edge.id)

    if (!before) {
      changes.push({
        label: `Добавлена связь ${edgeTitle(edge)}`,
        key: null,
      })
      continue
    }

    const beforeOptions = new Map(
      before.options.map((option) => [option.id, option]),
    )

    const afterOptions = new Map(
      edge.options.map((option) => [option.id, option]),
    )

    for (const option of edge.options) {
      const old = beforeOptions.get(option.id)

      if (!old) {
        changes.push({
          label: `Добавлен вариант проезда ${optionTitle(option)} (${edgeTitle(edge)})`,
          key: null,
        })
      } else if (!same(old, option)) {
        const toggledOnly =
          old.enabled !== option.enabled &&
          same({ ...old, enabled: option.enabled }, option)

        changes.push(
          toggledOnly
            ? {
                label: `${option.enabled ? 'Включён' : 'Отключён'} вариант проезда ${optionTitle(option)} (${edgeTitle(edge)})`,
                key: null,
              }
            : {
                label: `Изменён вариант проезда ${optionTitle(option)} (${edgeTitle(edge)})`,
                key: `option:${option.id}`,
              },
        )
      }
    }

    for (const option of before.options) {
      if (!afterOptions.has(option.id)) {
        changes.push({
          label: `Удалён вариант проезда ${optionTitle(option)} (${edgeTitle(edge)})`,
          key: null,
        })
      }
    }
  }

  for (const edge of removedEdges) {
    if (cascadeEdges.includes(edge)) continue

    changes.push({
      label: `Удалена связь ${edgeTitle(edge)}`,
      key: null,
    })
  }

  if (changes.length === 0) {
    return { label: 'Изменение', key: null }
  }

  if (changes.length === 1) return changes[0]!

  return {
    label: `${changes[0]!.label} (и ещё изменений: ${changes.length - 1})`,
    key: null,
  }
}

const AUTO_FIELDS = [
  'name',
  'timeZone',
  'timeZoneSource',
  'region',
  'country',
] as const

export type AutoNodePatch = Partial<
  Pick<TripNode, (typeof AUTO_FIELDS)[number]>
>

/**
 * Определяет правку, которую обычно вносят сами сервисы после добавления
 * точки: адрес, название и таймзона. Возвращает точку и новые значения,
 * если изменилась ровно одна точка и только этими полями.
 */
export function singleNodeAutoChange(
  prev: HistorySnapshot,
  next: HistorySnapshot,
): { nodeId: string; patch: AutoNodePatch } | null {
  if (
    prev.name !== next.name ||
    prev.nodes.length !== next.nodes.length ||
    !same(prev.edges, next.edges)
  ) {
    return null
  }

  let found: { nodeId: string; patch: AutoNodePatch } | null = null

  for (let index = 0; index < next.nodes.length; index++) {
    const before = prev.nodes[index]!
    const after = next.nodes[index]!

    if (before.id !== after.id) return null
    if (same(before, after)) continue
    if (found) return null

    const rest = (node: TripNode): unknown => {
      const copy: Record<string, unknown> = { ...node }
      for (const field of AUTO_FIELDS) delete copy[field]
      return copy
    }

    if (!same(rest(before), rest(after))) return null

    const patch: AutoNodePatch = {}

    for (const field of AUTO_FIELDS) {
      if (before[field] !== after[field]) {
        Object.assign(patch, { [field]: after[field] })
      }
    }

    found = { nodeId: after.id, patch }
  }

  return found
}

/** Копия снимка, в которой у точки заменены поля из patch. */
export function patchNode(
  snapshot: HistorySnapshot,
  nodeId: string,
  patch: AutoNodePatch,
): HistorySnapshot {
  const copy = cloneSnapshot(snapshot)
  const node = copy.nodes.find((item) => item.id === nodeId)

  if (node) Object.assign(node, patch)

  return copy
}
