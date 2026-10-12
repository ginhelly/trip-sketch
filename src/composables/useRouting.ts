import { computed, ref, watch } from 'vue'
import type { Ref } from 'vue'

import { DEFAULT_MAX_ROUTES, calculateRoute } from '../routing'

import type {
  FoundRoute,
  MapHighlight,
  RouteResultState,
  TripProject,
} from '../types'

export function useRouting(
  project: Ref<TripProject>,
  maxRoutes: () => number = () => DEFAULT_MAX_ROUTES,
) {
  const routeState = ref<RouteResultState>({
    result: null,
    stale: false,
  })

  const selectedRouteIndex = ref(0)

  const selectedRoute = computed<FoundRoute | null>(() => {
    const result = routeState.value.result

    if (result?.status !== 'found') return null

    return (
      result.routes[selectedRouteIndex.value] ??
      result.routes[0] ??
      null
    )
  })

  const highlight = computed<MapHighlight | null>(() => {
    const route = selectedRoute.value

    if (routeState.value.stale || !route) return null

    return {
      edgeIds: [
        ...new Set(route.legs.map((leg) => leg.edgeId)),
      ],
      nodeIds: [
        ...new Set([
          route.startNodeId,
          ...route.legs.map((leg) => leg.toNodeId),
        ]),
      ],
    }
  })

  watch(
    () => routeState.value.result,
    () => {
      selectedRouteIndex.value = 0
    },
    { flush: 'sync' },
  )

  watch(
    () => [
      project.value.nodes,
      project.value.edges,
      project.value.routeSearch,
    ],
    () => {
      if (routeState.value.result !== null) {
        routeState.value.stale = true
      }
    },
    {
      deep: true,
      flush: 'sync',
    },
  )

  function calculate(): void {
    routeState.value = {
      result: calculateRoute(project.value, project.value.routeSearch, {
        maxRoutes: maxRoutes(),
      }),
      stale: false,
    }
  }

  function resetRoutes(): void {
    routeState.value = {
      result: null,
      stale: false,
    }

    selectedRouteIndex.value = 0
  }

  return {
    routeState,
    selectedRouteIndex,
    selectedRoute,
    highlight,
    calculate,
    resetRoutes,
  }
}