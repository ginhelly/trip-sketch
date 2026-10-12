import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { describeChange, takeSnapshot } from './history'
import { useHistory } from './composables/useHistory'
import { createEmptyProject } from './storage'

import type { TravelOption, TripNode, TripProject } from './types'

function node(id: string, name = id.toUpperCase()): TripNode {
  return {
    id,
    name,
    coordinates: { lng: 10, lat: 20 },
    region: '',
    country: '',
    timeZone: 'Europe/Moscow',
    timeZoneSource: 'manual',
    minimumTransferMinutes: 0,
    layover: { mode: 'regular', options: [] },
  }
}

function option(id: string): TravelOption {
  const time = {
    localDateTime: '',
    timeZone: 'Europe/Moscow',
    disambiguation: 'reject' as const,
  }

  return {
    id,
    name: 'Поезд',
    descriptionMarkdown: '',
    cost: 10,
    departure: time,
    arrival: time,
    enabled: true,
  }
}

function projectWith(patch: Partial<TripProject>): TripProject {
  return { ...createEmptyProject(), ...patch }
}

describe('describeChange', () => {
  const base = projectWith({
    nodes: [node('a'), node('b')],
    edges: [
      { id: 'e1', fromNodeId: 'a', toNodeId: 'b', options: [option('o1')] },
    ],
  })

  function change(mutate: (draft: TripProject) => void) {
    const before = takeSnapshot(base)
    const draft = JSON.parse(JSON.stringify(base)) as TripProject

    mutate(draft)

    return describeChange(before, takeSnapshot(draft))
  }

  it('добавление точки', () => {
    expect(
      change((p) => p.nodes.push(node('c', 'Казань'))).label,
    ).toBe('Добавлена точка «Казань»')
  })

  it('перемещение точки не склеивается с переименованием', () => {
    const moved = change((p) => {
      p.nodes[0]!.coordinates = { lng: 11, lat: 21 }
    })

    expect(moved.label).toBe('Перемещена точка «A»')
    expect(moved.key).toBe('move:a')
  })

  it('переименование', () => {
    expect(
      change((p) => {
        p.nodes[0]!.name = 'Москва'
      }).label,
    ).toBe('Переименована точка «A» → «Москва»')
  })

  it('удаление точки учитывает каскадно удалённые связи', () => {
    const result = change((p) => {
      p.nodes = p.nodes.filter((item) => item.id !== 'b')
      p.edges = []
    })

    expect(result.label).toBe('Удалена точка «B» и связей: 1')
  })

  it('добавление, отключение и удаление варианта проезда', () => {
    expect(
      change((p) => p.edges[0]!.options.push(option('o2'))).label,
    ).toContain('Добавлен вариант проезда')

    expect(
      change((p) => {
        p.edges[0]!.options[0]!.enabled = false
      }).label,
    ).toContain('Отключён вариант проезда')

    expect(
      change((p) => {
        p.edges[0]!.options = []
      }).label,
    ).toContain('Удалён вариант проезда')
  })

  it('режим долгой пересадки', () => {
    expect(
      change((p) => {
        p.nodes[0]!.layover.mode = 'extended'
      }).label,
    ).toBe('Пересадка в «A»: долгая')
  })
})

describe('useHistory', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  function setup() {
    const project = ref(projectWith({ nodes: [node('a')] }))
    const scope = effectScope()

    const history = scope.run(() => useHistory({ project }))!

    return { project, history, scope }
  }

  it('записывает правки, отменяет и повторяет', async () => {
    const { project, history, scope } = setup()

    project.value.nodes.push(node('b'))
    await nextTick()

    expect(history.entries.value).toHaveLength(2)
    expect(history.canUndo.value).toBe(true)

    history.undo()
    await nextTick()

    expect(project.value.nodes.map((item) => item.id)).toEqual(['a'])
    // Откат не создаёт нового пункта истории.
    expect(history.entries.value).toHaveLength(2)
    expect(history.canRedo.value).toBe(true)

    history.redo()
    await nextTick()

    expect(project.value.nodes.map((item) => item.id)).toEqual(['a', 'b'])
    scope.stop()
  })

  it('новая правка после отката отбрасывает «будущее»', async () => {
    const { project, history, scope } = setup()

    project.value.nodes.push(node('b'))
    await nextTick()
    project.value.nodes.push(node('c'))
    await nextTick()

    history.jumpTo(1)
    await nextTick()

    project.value.nodes.push(node('d'))
    await nextTick()

    expect(history.entries.value).toHaveLength(3)
    expect(history.canRedo.value).toBe(false)
    expect(project.value.nodes.map((item) => item.id)).toEqual(['a', 'b', 'd'])
    scope.stop()
  })

  it('склеивает быстрый набор названия в один пункт', async () => {
    vi.useFakeTimers()

    const { project, history, scope } = setup()

    for (const name of ['М', 'Мо', 'Мос', 'Моск']) {
      project.value.nodes[0]!.name = name
      await nextTick()
    }

    expect(history.entries.value).toHaveLength(2)
    expect(history.entries.value[1]!.label).toBe(
      'Переименована точка «A» → «Моск»',
    )

    scope.stop()
  })

  it('автоматическая таймзона и адрес новой точки не создают пунктов', async () => {
    const { project, history, scope } = setup()

    project.value.nodes.push({
      ...node('b', 'Точка 2'),
      timeZone: null,
      timeZoneSource: 'unknown',
    })
    await nextTick()

    // Ещё одна точка добавлена раньше, чем пришёл ответ сервисов.
    project.value.nodes.push(node('c'))
    await nextTick()

    const b = project.value.nodes.find((item) => item.id === 'b')!
    b.timeZone = 'Europe/Moscow'
    b.timeZoneSource = 'automatic'
    b.name = 'Москва'
    await nextTick()

    expect(history.entries.value).toHaveLength(3)
    expect(history.entries.value[1]!.label).toBe('Добавлена точка «Москва»')

    history.jumpTo(1)
    await nextTick()

    const restored = project.value.nodes.find((item) => item.id === 'b')!
    expect(restored.timeZone).toBe('Europe/Moscow')
    expect(restored.name).toBe('Москва')
    scope.stop()
  })

  it('все правки за одно открытие диалога дают один пункт', async () => {
    const { project, history, scope } = setup()

    history.beginGroup(() => 'Изменена точка «A»')

    project.value.nodes[0]!.name = 'Мос'
    await nextTick()
    project.value.nodes[0]!.name = 'Москва'
    await nextTick()
    project.value.nodes[0]!.minimumTransferMinutes = 30
    await nextTick()

    expect(history.entries.value).toHaveLength(2)
    expect(history.entries.value[1]!.label).toBe('Изменена точка «Москва»')

    history.endGroup()

    project.value.nodes[0]!.minimumTransferMinutes = 45
    await nextTick()

    expect(history.entries.value).toHaveLength(3)

    history.undo()
    await nextTick()
    expect(project.value.nodes[0]!.name).toBe('Москва')
    expect(project.value.nodes[0]!.minimumTransferMinutes).toBe(30)

    history.undo()
    await nextTick()
    expect(project.value.nodes[0]!.name).toBe('A')
    scope.stop()
  })

  it('reset начинает историю заново', async () => {
    const { project, history, scope } = setup()

    project.value.nodes.push(node('b'))
    await nextTick()

    history.reset()
    await nextTick()

    expect(history.entries.value).toHaveLength(1)
    expect(history.canUndo.value).toBe(false)
    scope.stop()
  })

  it('после удаления точки сбрасывает начало маршрута, которого нет', async () => {
    const { project, history, scope } = setup()

    project.value.nodes.push(node('b'))
    await nextTick()

    project.value.routeSearch.startNodeId = 'b'
    history.undo()

    expect(project.value.routeSearch.startNodeId).toBeNull()
    scope.stop()
  })
})
