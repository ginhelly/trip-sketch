import { onScopeDispose, ref, watch } from 'vue'
import type { Ref } from 'vue'

import type { GeocoderProvider } from '../services'

import {
  lookupTimeZones,
  reverseGeocode,
  searchPlaces,
} from '../services'

import type {
  Coordinates,
  GeocodingResult,
  NodeId,
  TripNode,
  TripProject,
} from '../types'

const SEARCH_DEBOUNCE_MS = 450
const MIN_QUERY_LENGTH = 2

export interface UseGeocodingOptions {
  project: Ref<TripProject>
  notify: (message: string) => void
  /** Какой геокодер использовать сейчас. */
  provider?: () => GeocoderProvider
  /** Вызывается после автоматического определения таймзоны точки. */
  onNodeTimeZoneDetected?: (nodeId: NodeId) => void
}

interface ReverseRequest {
  controller: AbortController
  token: number
}

export function useGeocoding(options: UseGeocodingOptions) {
  const { project, notify } = options

  const searchQuery = ref('')
  const searchResults = ref<GeocodingResult[]>([])
  const searchBusy = ref(false)
  const searchError = ref('')
  const reverseBusyCount = ref(0)

  let searchTimer: ReturnType<typeof setTimeout> | undefined
  let searchController: AbortController | null = null
  let searchVersion = 0
  let disposed = false

  // Поколение проекта. Увеличивается при любой замене проекта,
  // поэтому ответы для старого проекта отбрасываются
  // даже при импорте проекта с тем же ID.
  let projectEpoch = 0

  // Глобально уникальные токены операций: удаление записи из карты
  // гарантирует, что старый ответ не совпадёт с новым токеном.
  let nextToken = 0

  const reverseRequests = new Map<NodeId, ReverseRequest>()
  const timeZoneTokens = new Map<NodeId, number>()

  function findNode(nodeId: NodeId): TripNode | undefined {
    return project.value.nodes.find((item) => item.id === nodeId)
  }

  function syncReverseBusy(): void {
    reverseBusyCount.value = reverseRequests.size
  }

  function abortReverse(nodeId: NodeId): void {
    const request = reverseRequests.get(nodeId)
    if (!request) return

    reverseRequests.delete(nodeId)
    request.controller.abort()
    syncReverseBusy()
  }

  async function lookupNodePlace(
    nodeId: NodeId,
    replaceNameIfUnchanged?: string,
  ): Promise<void> {
    const node = findNode(nodeId)
    if (!node || disposed) return

    abortReverse(nodeId)

    const epoch = projectEpoch
    const coordinates = { ...node.coordinates }
    const controller = new AbortController()
    const token = ++nextToken

    reverseRequests.set(nodeId, { controller, token })
    syncReverseBusy()

    const isStale = (): boolean =>
      disposed ||
      epoch !== projectEpoch ||
      reverseRequests.get(nodeId)?.token !== token

    try {
      const results = await reverseGeocode(coordinates, {
        signal: controller.signal,
        provider: options.provider?.(),
      })

      if (isStale()) return

      const current = findNode(nodeId)

      if (!current || !sameCoordinates(current.coordinates, coordinates)) {
        return
      }

      const result = results[0]

      if (!result) {
        notify('Адрес не найден. Название точки можно ввести вручную.')
        return
      }

      // Координаты точки не заменяются координатами геокодера.
      current.region = result.region
      current.country = result.country

      if (
        replaceNameIfUnchanged !== undefined &&
        current.name === replaceNameIfUnchanged
      ) {
        current.name = result.locality || result.name
      }

      notify(`По координатам найдено: ${result.displayName}`)
    } catch (error) {
      if (!controller.signal.aborted && !isStale()) {
        notify(errorMessage(error))
      }
    } finally {
      if (reverseRequests.get(nodeId)?.controller === controller) {
        reverseRequests.delete(nodeId)
        syncReverseBusy()
      }
    }
  }

  async function determineNodeTimeZone(nodeId: NodeId): Promise<void> {
    const node = findNode(nodeId)

    if (!node || disposed || node.timeZoneSource === 'manual') return

    const epoch = projectEpoch
    const coordinates = { ...node.coordinates }
    const token = ++nextToken

    timeZoneTokens.set(nodeId, token)

    // Актуальная точка, если ответ ещё применим, иначе null.
    const currentNode = (): TripNode | null => {
      if (
        disposed ||
        epoch !== projectEpoch ||
        timeZoneTokens.get(nodeId) !== token
      ) {
        return null
      }

      const current = findNode(nodeId)

      if (
        !current ||
        current.timeZoneSource === 'manual' ||
        !sameCoordinates(current.coordinates, coordinates)
      ) {
        return null
      }

      return current
    }

    try {
      const zones = await lookupTimeZones(coordinates)
      const current = currentNode()

      if (!current) return

      if (zones.length !== 1) {
        notify(
          `Для «${current.name}» найдены разные таймзоны: ` +
            `${zones.join(', ')}. Выберите вручную.`,
        )
        return
      }

      const timeZone = zones[0]!

      current.timeZone = timeZone
      current.timeZoneSource = 'automatic'

      // Заполняем только пустые таймзоны карточек.
      // Уже заданное время существующих рейсов не изменяем.
      for (const edge of project.value.edges) {
        for (const option of edge.options) {
          if (
            edge.fromNodeId === nodeId &&
            !option.departure.timeZone.trim()
          ) {
            option.departure.timeZone = timeZone
          }

          if (
            edge.toNodeId === nodeId &&
            !option.arrival.timeZone.trim()
          ) {
            option.arrival.timeZone = timeZone
          }
        }
      }

      options.onNodeTimeZoneDetected?.(nodeId)
    } catch (error) {
      const current = currentNode()

      if (current) {
        notify(
          `Таймзону «${current.name}» определите вручную. ` +
            errorMessage(error),
        )
      }
    } finally {
      if (timeZoneTokens.get(nodeId) === token) {
        timeZoneTokens.delete(nodeId)
      }
    }
  }

  /** Отменяет операции точки при её перемещении или удалении. */
  function invalidateNode(nodeId: NodeId): void {
    abortReverse(nodeId)
    timeZoneTokens.delete(nodeId)
  }

  function cancelPendingLookups(): void {
    projectEpoch++

    for (const request of reverseRequests.values()) {
      request.controller.abort()
    }

    reverseRequests.clear()
    timeZoneTokens.clear()
    syncReverseBusy()
  }

  function cancelSearch(): void {
    if (searchTimer !== undefined) {
      clearTimeout(searchTimer)
      searchTimer = undefined
    }

    searchController?.abort()
    searchController = null
    searchVersion++
    searchBusy.value = false
  }

  function clearSearch(): void {
    cancelSearch()

    searchQuery.value = ''
    searchResults.value = []
    searchError.value = ''
  }

  /** Вызывается при замене проекта. */
  function resetForNewProject(): void {
    cancelPendingLookups()
    clearSearch()
  }

  // Замена объекта проекта в обход resetForNewProject
  // тоже инвалидирует незавершённые операции.
  watch(
    () => project.value,
    (next, previous) => {
      if (next !== previous) cancelPendingLookups()
    },
    { flush: 'sync' },
  )

  watch(searchQuery, (query) => {
    cancelSearch()

    const version = searchVersion
    searchResults.value = []
    searchError.value = ''

    if (query.trim().length < MIN_QUERY_LENGTH) return

    searchTimer = setTimeout(async () => {
      searchTimer = undefined

      const controller = new AbortController()
      searchController = controller
      searchBusy.value = true

      try {
        const results = await searchPlaces(query, {
          signal: controller.signal,
          provider: options.provider?.(),
          bias: project.value.camera.center,
        })

        if (!disposed && version === searchVersion) {
          searchResults.value = results

          if (results.length === 0) {
            searchError.value = 'Ничего не найдено.'
          }
        }
      } catch (error) {
        if (
          !disposed &&
          version === searchVersion &&
          !controller.signal.aborted
        ) {
          searchError.value = errorMessage(error)
        }
      } finally {
        if (!disposed && version === searchVersion) {
          searchBusy.value = false
          searchController = null
        }
      }
    }, SEARCH_DEBOUNCE_MS)
  })

  onScopeDispose(() => {
    disposed = true
    cancelSearch()
    cancelPendingLookups()
  })

  return {
    searchQuery,
    searchResults,
    searchBusy,
    searchError,
    reverseBusyCount,
    clearSearch,
    lookupNodePlace,
    determineNodeTimeZone,
    invalidateNode,
    resetForNewProject,
  }
}

function sameCoordinates(a: Coordinates, b: Coordinates): boolean {
  return a.lng === b.lng && a.lat === b.lat
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
