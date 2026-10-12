import { describe, expect, it, vi } from 'vitest'

import { calculateRoute } from './routing'
import { createEmptyProject } from './storage'

import type {
  NodeLayover,
  StayOption,
  TravelOption,
  TripNode,
  TripProject,
} from './types'

// browser-geo-tz при загрузке обращается к window; для расчёта он не нужен.
vi.mock('browser-geo-tz', () => ({ find: async () => [] }))

const TZ = 'Europe/Moscow'

function node(id: string, layover?: NodeLayover): TripNode {
  return {
    id,
    name: id.toUpperCase(),
    coordinates: { lng: 0, lat: 0 },
    region: '',
    country: '',
    timeZone: TZ,
    timeZoneSource: 'manual',
    minimumTransferMinutes: 0,
    layover: layover ?? { mode: 'regular', options: [] },
  }
}

function card(
  id: string,
  cost: number,
  departure: string,
  arrival: string,
): TravelOption {
  return {
    id,
    name: id,
    descriptionMarkdown: '',
    cost,
    departure: { localDateTime: departure, timeZone: TZ, disambiguation: 'reject' },
    arrival: { localDateTime: arrival, timeZone: TZ, disambiguation: 'reject' },
    enabled: true,
  }
}

function stay(patch: Partial<StayOption> = {}): StayOption {
  return {
    id: 's1',
    name: 'Хостел',
    descriptionMarkdown: '',
    pricing: 'per-night',
    rate: 20,
    enabled: true,
    ...patch,
  }
}

function project(
  nodes: TripNode[],
  edges: Array<[string, string, TravelOption[]]>,
  optimization: 'cheapest' | 'earliest-arrival' = 'cheapest',
): TripProject {
  const base = createEmptyProject()

  return {
    ...base,
    nodes,
    edges: edges.map(([from, to, options], index) => ({
      id: `e${index}`,
      fromNodeId: from,
      toNodeId: to,
      options,
    })),
    routeSearch: {
      startNodeId: 'a',
      endNodeId: 'c',
      earliestDeparture: {
        localDateTime: '2026-10-20T00:00',
        timeZone: TZ,
        disambiguation: 'reject',
      },
      optimization,
    },
  }
}

function firstRoute(result: ReturnType<typeof calculateRoute>) {
  if (result.status !== 'found') {
    throw new Error(`Маршрут не найден: ${result.status}`)
  }

  return result.routes[0]!
}

describe('долгая пересадка в маршруте', () => {
  const edges: Array<[string, string, TravelOption[]]> = [
    ['a', 'b', [card('ab', 100, '2026-10-20T08:00', '2026-10-20T10:00')]],
    ['b', 'c', [card('bc', 100, '2026-10-21T09:00', '2026-10-21T11:00')]],
  ]

  it('в обычном режиме ожидание бесплатно', () => {
    const route = firstRoute(
      calculateRoute(project([node('a'), node('b'), node('c')], edges)),
    )

    expect(route.summary.totalCost).toBe(200)
    expect(route.legs[1]!.stayBefore).toBeUndefined()
  })

  it('в долгом режиме добавляет ночь к стоимости и показывает её в ноге', () => {
    const b = node('b', { mode: 'extended', options: [stay()] })

    const route = firstRoute(
      calculateRoute(project([node('a'), b, node('c')], edges)),
    )

    expect(route.summary.totalCost).toBe(220)
    expect(route.legs[1]!.stayBefore).toMatchObject({
      optionName: 'Хостел',
      units: 1,
      cost: 20,
    })
  })

  it('короткая пересадка в долгом режиме бесплатна', () => {
    const b = node('b', { mode: 'extended', options: [stay()] })

    const route = firstRoute(
      calculateRoute(
        project(
          [node('a'), b, node('c')],
          [
            ['a', 'b', [card('ab', 100, '2026-10-20T08:00', '2026-10-20T10:00')]],
            ['b', 'c', [card('bc', 100, '2026-10-20T12:00', '2026-10-20T14:00')]],
          ],
        ),
      ),
    )

    expect(route.summary.totalCost).toBe(200)
  })

  it('режим «долгая» без вариантов не блокирует маршрут', () => {
    const b = node('b', { mode: 'extended', options: [] })

    const route = firstRoute(
      calculateRoute(project([node('a'), b, node('c')], edges)),
    )

    expect(route.summary.totalCost).toBe(200)
  })

  it('«Самые дешёвые» предпочитает вариант без платной ночёвки', () => {
    const b = node('b', { mode: 'extended', options: [stay({ rate: 500 })] })

    const withDirect: Array<[string, string, TravelOption[]]> = [
      ...edges,
      ['a', 'c', [card('ac', 400, '2026-10-20T08:00', '2026-10-20T20:00')]],
    ]

    const route = firstRoute(
      calculateRoute(project([node('a'), b, node('c')], withDirect)),
    )

    expect(route.legs.map((leg) => leg.optionId)).toEqual(['ac'])
    expect(route.summary.totalCost).toBe(400)
  })

  it('«Самое раннее прибытие» всё равно считает стоимость пребывания', () => {
    const b = node('b', { mode: 'extended', options: [stay({ rate: 500 })] })

    const route = firstRoute(
      calculateRoute(
        project([node('a'), b, node('c')], edges, 'earliest-arrival'),
      ),
    )

    expect(route.summary.totalCost).toBe(700)
  })
})
