import {
  resolveZonedDateTime,
  validateTravelOption,
} from './services'

import type {
  NoRouteReason,
  ResolvedTravelOption,
  RouteCalculationResult,
  RouteDiagnostics,
  RouteLeg,
  RouteSearchParameters,
  TripEdge,
  TripNode,
  TripProject,
  ValidationIssue,
} from './types'

interface RouteLabel {
  option: ResolvedTravelOption
  totalCost: number
  legCount: number
  previous: RouteLabel | null
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
      left.arrival.epochMilliseconds - right.arrival.epochMilliseconds ||
      left.cost - right.cost ||
      left.optionId.localeCompare(right.optionId),
  )

  return { options, diagnostics }
}

function reconstructLegs(
  finalLabel: RouteLabel,
  startMilliseconds: number,
): RouteLeg[] {
  const chain: ResolvedTravelOption[] = []
  let current: RouteLabel | null = finalLabel

  while (current !== null) {
    chain.push(current.option)
    current = current.previous
  }

  chain.reverse()

  let previousArrival = startMilliseconds

  return chain.map((option): RouteLeg => {
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
      waitingBeforeMinutes: (departure - previousArrival) / 60_000,
    }

    previousArrival = arrival
    return leg
  })
}

function betterFinalLabel(
  candidate: RouteLabel,
  current: RouteLabel | null,
  optimization: RouteSearchParameters['optimization'],
): boolean {
  if (current === null) return true

  const candidateArrival = candidate.option.arrival.epochMilliseconds
  const currentArrival = current.option.arrival.epochMilliseconds

  if (optimization === 'cheapest') {
    if (candidate.totalCost !== current.totalCost) {
      return candidate.totalCost < current.totalCost
    }

    if (candidateArrival !== currentArrival) {
      return candidateArrival < currentArrival
    }
  } else {
    if (candidateArrival !== currentArrival) {
      return candidateArrival < currentArrival
    }

    if (candidate.totalCost !== current.totalCost) {
      return candidate.totalCost < current.totalCost
    }
  }

  return candidate.legCount < current.legCount
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
): RouteCalculationResult {
  const issues: ValidationIssue[] = []
  const nodeMap = new Map(project.nodes.map((node) => [node.id, node]))

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
        message: `Некорректное время пересадки в точке «${node.name}».`,
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

  const startMilliseconds = requestedDeparture.value.epochMilliseconds

  if (startNodeId === endNodeId) {
    return {
      status: 'found',
      calculatedAt: new Date().toISOString(),
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
  }

  if (!hasDirectedPath(startNodeId, endNodeId, project.edges)) {
    return missingRoute('no-directed-path', diagnostics)
  }

  const usableEdgeIds = new Set(options.map((option) => option.edgeId))
  const usableEdges = project.edges.filter((edge) =>
    usableEdgeIds.has(edge.id),
  )

  if (!hasDirectedPath(startNodeId, endNodeId, usableEdges)) {
    return missingRoute('no-usable-options', diagnostics)
  }

  const labelsByArrivalNode = new Map<string, RouteLabel[]>()
  let bestFinal: RouteLabel | null = null

  for (const option of options) {
    const departure = option.departure.epochMilliseconds

    if (departure < startMilliseconds) continue

    let bestCost = Number.POSITIVE_INFINITY
    let bestLegCount = Number.POSITIVE_INFINITY
    let bestPrevious: RouteLabel | null = null
    let reachable = false

    // Начальное ожидание не требует запаса на пересадку.
    if (option.fromNodeId === startNodeId) {
      bestCost = option.cost
      bestLegCount = 1
      reachable = true
    }

    const transferMilliseconds =
      nodeMap.get(option.fromNodeId)!.minimumTransferMinutes * 60_000

    for (
      const previous of labelsByArrivalNode.get(option.fromNodeId) ?? []
    ) {
      const readyAt =
        previous.option.arrival.epochMilliseconds +
        transferMilliseconds

      if (readyAt > departure) continue

      const candidateCost = previous.totalCost + option.cost
      const candidateLegCount = previous.legCount + 1

      if (
        candidateCost < bestCost ||
        (candidateCost === bestCost && candidateLegCount < bestLegCount)
      ) {
        bestCost = candidateCost
        bestLegCount = candidateLegCount
        bestPrevious = previous
        reachable = true
      }
    }

    if (!reachable) continue

    if (!Number.isFinite(bestCost)) {
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

    const label: RouteLabel = {
      option,
      totalCost: bestCost,
      legCount: bestLegCount,
      previous: bestPrevious,
    }

    const nodeLabels =
      labelsByArrivalNode.get(option.toNodeId) ?? []

    nodeLabels.push(label)
    labelsByArrivalNode.set(option.toNodeId, nodeLabels)

    if (
      option.toNodeId === endNodeId &&
      betterFinalLabel(label, bestFinal, parameters.optimization)
    ) {
      bestFinal = label
    }
  }

  if (bestFinal === null) {
    return missingRoute('no-feasible-schedule', diagnostics)
  }

  const legs = reconstructLegs(bestFinal, startMilliseconds)

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
    calculatedAt: new Date().toISOString(),
    optimization: parameters.optimization,
    startNodeId,
    endNodeId,
    requestedDeparture: requestedDeparture.value,
    arrival: bestFinal.option.arrival,
    legs,
    summary: {
      totalCost: bestFinal.totalCost,
      totalTravelMinutes,
      totalWaitingMinutes,
      totalDurationMinutes:
        (bestFinal.option.arrival.epochMilliseconds - startMilliseconds) /
        60_000,
      legCount: legs.length,
    },
    diagnostics,
  }
}