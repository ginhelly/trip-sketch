import type { Ref } from 'vue'

import { localDateTimeAt } from '../services'

import type {
  NodeId,
  TripProject,
} from '../types'

export interface UseRouteSearchParamsOptions {
  project: Ref<TripProject>
  notify: (message: string) => void
}

export function useRouteSearchParams(options: UseRouteSearchParamsOptions) {
  const { project, notify } = options

  function setRouteStart(nodeId: NodeId): void {
    project.value.routeSearch.startNodeId = nodeId
    applyStartTimeZone()
  }

  function setRouteEnd(nodeId: NodeId): void {
    project.value.routeSearch.endNodeId = nodeId
  }

  function applyStartTimeZone(): void {
    const search = project.value.routeSearch
    const node = project.value.nodes.find(
      (item) => item.id === search.startNodeId,
    )

    if (!node) return

    search.earliestDeparture.timeZone = node.timeZone ?? ''
    search.earliestDeparture.disambiguation = 'reject'

    if (!search.earliestDeparture.localDateTime && node.timeZone) {
      try {
        search.earliestDeparture.localDateTime = localDateTimeAt(
          Date.now(),
          node.timeZone,
        )
      } catch {
        notify('Проверьте таймзону начальной точки.')
      }
    }
  }

  /** Подставляет таймзону старта, если она ещё не задана. */
  function handleNodeTimeZoneDetected(nodeId: NodeId): void {
    const search = project.value.routeSearch

    if (
      search.startNodeId === nodeId &&
      !search.earliestDeparture.timeZone.trim()
    ) {
      applyStartTimeZone()
    }
  }

  return {
    setRouteStart,
    setRouteEnd,
    applyStartTimeZone,
    handleNodeTimeZoneDetected,
  }
}
