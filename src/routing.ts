import { computeStayCharge } from './layover'

import {
  resolveZonedDateTime,
  validateTravelOption,
} from './services'

import type {
  FoundRoute,
  NoRouteReason,
  OptimizationMode,
  ResolvedTravelOption,
  RouteCalculationResult,
  RouteDiagnostics,
  RouteLeg,
  RouteSearchParameters,
  StayCharge,
  TripEdge,
  TripNode,
  TripProject,
  ValidationIssue,
} from './types'

export const DEFAULT_MAX_ROUTES = 3

export interface CalculateOptions {
  /** Сколько вариантов маршрута вернуть. */
  maxRoutes?: number
}

interface RouteLabel {
  option: ResolvedTravelOption
  /** Плата за долгую пересадку перед этим рейсом. */
  stay: StayCharge | null
  totalCost: number
  legCount: number
  previous: RouteLabel | null
  pathKey: string
}

function hasDirectedPath(
  startNodeId: string,
  endNodeId: string,
  edges: readonly TripEdge[],
): boolean {
  if (startNodeId === endNodeId) return true

  const outgoing = new Map<string, string[]>()

  for (const edge of edges) {
    const destinations = outgoing.get(edge.fromNodeId) ?? []
    destinations.push(edge.toNodeId)
    outgoing.set(edge.fromNodeId, destinations)
  }

  const visited = new Set<string>([startNodeId])
  const queue = [startNodeId]

  for (let index = 0; index < queue.length; index++) {
    const current = queue[index]!

    for (const destination of outgoing.get(current) ?? []) {
      if (destination === endNodeId) return true

      if (!visited.has(destination)) {
        visited.add(destination)
        queue.push(destination)
      }
    }
  }

  return false
}

function collectOptions(
  nodes: readonly TripNode[],
  edges: readonly TripEdge[],
): {
  options: ResolvedTravelOption[]
  diagnostics: RouteDiagnostics
} {
  const options: ResolvedTravelOption[] = []

  const diagnostics: RouteDiagnostics = {
    totalOptions: 0,
    disabledOptions: 0,
    invalidOptions: 0,
    usableOptions: 0,
    issues: [],
  }

  for (const edge of edges) {
    for (const option of edge.options) {
      diagnostics.totalOptions++

      if (!option.enabled) {
        diagnostics.disabledOptions++
        continue
      }

      const validation = validateTravelOption(edge, option, nodes)

      if (!validation.ok) {
        diagnostics.invalidOptions++
        diagnostics.issues.push({
          edgeId: edge.id,
          optionId: option.id,
          issues: validation.issues,
        })
        continue
      }

      options.push(validation.value)
      diagnostics.usableOptions++
    }
  }

  options.sort(
    (left, right) =>
      left.departure.epochMilliseconds -
        right.departure.epochMilliseconds ||
      left.arrival.epochMilliseconds -
        right.arrival.epochMilliseconds ||
      left.cost - right.cost ||
      left.edgeId.localeCompare(right.edgeId) ||
      left.optionId.localeCompare(right.optionId),
  )

  return { options, diagnostics }
}

function createLabel(
  option: ResolvedTravelOption,
  previous: RouteLabel | null,
  stay: StayCharge | null = null,
): RouteLabel {
  return {
    option,
    stay,
    totalCost:
      (previous?.totalCost ?? 0) + (stay?.cost ?? 0) + option.cost,
    legCount: (previous?.legCount ?? 0) + 1,
    previous,
    pathKey:
      (previous?.pathKey ?? '') +
      JSON.stringify([option.edgeId, option.optionId]) +
      '\n',
  }
}

function compareLabels(
  left: RouteLabel,
  right: RouteLabel,
  optimization: OptimizationMode,
): number {
  const leftArrival = left.option.arrival.epochMilliseconds
  const rightArrival = right.option.arrival.epochMilliseconds

  if (optimization === 'cheapest') {
    if (left.totalCost !== right.totalCost) {
      return left.totalCost - right.totalCost
    }

    if (leftArrival !== rightArrival) {
      return leftArrival - rightArrival
    }
  } else {
    if (leftArrival !== rightArrival) {
      return leftArrival - rightArrival
    }

    if (left.totalCost !== right.totalCost) {
      return left.totalCost - right.totalCost
    }
  }

  if (left.legCount !== right.legCount) {
    return left.legCount - right.legCount
  }

  return left.pathKey.localeCompare(right.pathKey)
}

function takeBestLabels(
  labels: readonly RouteLabel[],
  optimization: OptimizationMode,
  limit: number,
): RouteLabel[] {
  const unique = new Map<string, RouteLabel>()

  for (const label of labels) {
    if (!Number.isFinite(label.totalCost)) continue
    unique.set(label.pathKey, label)
  }

  return [...unique.values()]
    .sort((left, right) => compareLabels(left, right, optimization))
    .slice(0, limit)
}

function reconstructLegs(
  finalLabel: RouteLabel,
  startMilliseconds: number,
): RouteLeg[] {
  const chain: RouteLabel[] = []
  let current: RouteLabel | null = finalLabel

  while (current !== null) {
    chain.push(current)
    current = current.previous
  }

  chain.reverse()

  let previousArrival = startMilliseconds

  return chain.map(({ option, stay }): RouteLeg => {
    const departure = option.departure.epochMilliseconds
    const arrival = option.arrival.epochMilliseconds

    const leg: RouteLeg = {
      edgeId: option.edgeId,
      optionId: option.optionId,
      fromNodeId: option.fromNodeId,
      toNodeId: option.toNodeId,
      optionName: option.name,
      cost: option.cost,
      departure: option.departure,
      arrival: option.arrival,
      travelMinutes: (arrival - departure) / 60_000,
      waitingBeforeMinutes:
        (departure - previousArrival) / 60_000,
      ...(stay ? { stayBefore: stay } : {}),
    }

    previousArrival = arrival
    return leg
  })
}

function missingRoute(
  reason: NoRouteReason,
  diagnostics: RouteDiagnostics,
): RouteCalculationResult {
  const messages: Record<NoRouteReason, string> = {
    'no-directed-path':
      'Между выбранными точками нет направленного пути в нарисованном графе.',
    'no-usable-options':
      'Нет пути, составленного из включённых и корректно заполненных вариантов проезда.',
    'no-feasible-schedule':
      'Нет допустимого маршрута по введённым отправлениям, времени старта и ограничениям пересадок.',
  }

  return {
    status: 'not-found',
    calculatedAt: new Date().toISOString(),
    reason,
    message: messages[reason],
    diagnostics,
  }
}

export function calculateRoute(
  project: TripProject,
  parameters: RouteSearchParameters = project.routeSearch,
  calcOptions: CalculateOptions = {},
): RouteCalculationResult {
  const maxRoutes = Math.max(
    1,
    Math.floor(calcOptions.maxRoutes ?? DEFAULT_MAX_ROUTES),
  )

  const issues: ValidationIssue[] = []
  const nodeMap = new Map(
    project.nodes.map((node) => [node.id, node]),
  )

  const startNodeId = parameters.startNodeId
  const endNodeId = parameters.endNodeId

  if (!startNodeId || !nodeMap.has(startNodeId)) {
    issues.push({
      code: 'missing-node',
      message: 'Выберите существующую начальную точку.',
      field: 'routeSearch.startNodeId',
    })
  }

  if (!endNodeId || !nodeMap.has(endNodeId)) {
    issues.push({
      code: 'missing-node',
      message: 'Выберите существующую конечную точку.',
      field: 'routeSearch.endNodeId',
    })
  }

  if (
    parameters.optimization !== 'cheapest' &&
    parameters.optimization !== 'earliest-arrival'
  ) {
    issues.push({
      code: 'invalid-project',
      message: 'Неизвестный критерий оптимизации.',
      field: 'routeSearch.optimization',
    })
  }

  for (const node of project.nodes) {
    if (
      !Number.isFinite(node.minimumTransferMinutes) ||
      node.minimumTransferMinutes < 0
    ) {
      issues.push({
        code: 'invalid-transfer-duration',
        message:
          `Некорректное время пересадки в точке «${node.name}».`,
        field: `nodes.${node.id}.minimumTransferMinutes`,
      })
    }
  }

  const requestedDeparture = resolveZonedDateTime(
    parameters.earliestDeparture,
    'routeSearch.earliestDeparture',
  )

  if (!requestedDeparture.ok) {
    issues.push(...requestedDeparture.issues)
  }

  if (
    issues.length > 0 ||
    !requestedDeparture.ok ||
    !startNodeId ||
    !endNodeId
  ) {
    return { status: 'invalid-request', issues }
  }

  const { options, diagnostics } = collectOptions(
    project.nodes,
    project.edges,
  )

  const calculatedAt = new Date().toISOString()
  const startMilliseconds =
    requestedDeparture.value.epochMilliseconds

  if (startNodeId === endNodeId) {
    const route: FoundRoute = {
      status: 'found',
      calculatedAt,
      optimization: parameters.optimization,
      startNodeId,
      endNodeId,
      requestedDeparture: requestedDeparture.value,
      arrival: requestedDeparture.value,
      legs: [],
      summary: {
        totalCost: 0,
        totalTravelMinutes: 0,
        totalWaitingMinutes: 0,
        totalDurationMinutes: 0,
        legCount: 0,
      },
      diagnostics,
    }

    return {
      status: 'found',
      calculatedAt,
      optimization: parameters.optimization,
      routes: [route],
      diagnostics,
    }
  }

  if (!hasDirectedPath(startNodeId, endNodeId, project.edges)) {
    return missingRoute('no-directed-path', diagnostics)
  }

  const usableEdgeIds = new Set(
    options.map((option) => option.edgeId),
  )

  const usableEdges = project.edges.filter((edge) =>
    usableEdgeIds.has(edge.id),
  )

  if (!hasDirectedPath(startNodeId, endNodeId, usableEdges)) {
    return missingRoute('no-usable-options', diagnostics)
  }

  const labelsByArrivalNode = new Map<string, RouteLabel[]>()
  let finalLabels: RouteLabel[] = []

  for (const option of options) {
    const departure = option.departure.epochMilliseconds

    if (departure < startMilliseconds) continue

    const candidates: RouteLabel[] = []

    if (option.fromNodeId === startNodeId) {
      candidates.push(createLabel(option, null))
    }

    const fromNode = nodeMap.get(option.fromNodeId)!
    const transferMilliseconds =
      fromNode.minimumTransferMinutes * 60_000

    const previousLabels =
      labelsByArrivalNode.get(option.fromNodeId) ?? []

    for (const previous of previousLabels) {
      const readyAt =
        previous.option.arrival.epochMilliseconds +
        transferMilliseconds

      if (readyAt > departure) continue

      const stay = computeStayCharge(
        fromNode.layover,
        previous.option.arrival.epochMilliseconds,
        departure,
        fromNode.timeZone ?? previous.option.arrival.timeZone,
      )

      candidates.push(createLabel(option, previous, stay))
    }

    if (candidates.length === 0) continue

    if (
      candidates.some(
        (candidate) => !Number.isFinite(candidate.totalCost),
      )
    ) {
      return {
        status: 'invalid-request',
        issues: [
          {
            code: 'invalid-cost',
            message:
              'Суммарная стоимость превышает допустимый числовой диапазон. Уменьшите значения стоимости.',
          },
        ],
      }
    }

    // Ограничиваем число путей только для этого конкретного рейса.
    // Состояния разных рейсов в одном городе не объединяем.
    const bestForOption = takeBestLabels(
      candidates,
      parameters.optimization,
      maxRoutes,
    )

    // Достигнув конечной точки, маршрут завершаем.
    if (option.toNodeId === endNodeId) {
      finalLabels = takeBestLabels(
        [...finalLabels, ...bestForOption],
        parameters.optimization,
        maxRoutes,
      )
      continue
    }

    const nodeLabels =
      labelsByArrivalNode.get(option.toNodeId) ?? []

    nodeLabels.push(...bestForOption)

    labelsByArrivalNode.set(
      option.toNodeId,
      nodeLabels,
    )
  }

  if (finalLabels.length === 0) {
    return missingRoute('no-feasible-schedule', diagnostics)
  }

  const routes: FoundRoute[] = finalLabels.map((label) => {
    const legs = reconstructLegs(label, startMilliseconds)

    const totalTravelMinutes = legs.reduce(
      (total, leg) => total + leg.travelMinutes,
      0,
    )

    const totalWaitingMinutes = legs.reduce(
      (total, leg) => total + leg.waitingBeforeMinutes,
      0,
    )

    return {
      status: 'found',
      calculatedAt,
      optimization: parameters.optimization,
      startNodeId,
      endNodeId,
      requestedDeparture: requestedDeparture.value,
      arrival: label.option.arrival,
      legs,
      summary: {
        totalCost: label.totalCost,
        totalTravelMinutes,
        totalWaitingMinutes,
        totalDurationMinutes:
          (label.option.arrival.epochMilliseconds -
            startMilliseconds) /
          60_000,
        legCount: legs.length,
      },
      diagnostics,
    }
  })

  return {
    status: 'found',
    calculatedAt,
    optimization: parameters.optimization,
    routes,
    diagnostics,
  }
}