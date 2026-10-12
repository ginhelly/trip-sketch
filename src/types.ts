export type NodeId = string
export type EdgeId = string
export type TravelOptionId = string

export type TimeZoneSource = 'automatic' | 'manual' | 'unknown'

export type OptimizationMode = 'cheapest' | 'earliest-arrival'

export type EditorMode = 'select' | 'add-node' | 'add-edge'

export type DstDisambiguation = 'reject' | 'earlier' | 'later'

export interface Coordinates {
  lng: number
  lat: number
}

export type LayoverMode = 'regular' | 'extended'

export type StayPricing = 'per-night' | 'per-hour'

export interface StayOption {
  id: string
  name: string
  descriptionMarkdown: string
  pricing: StayPricing
  /** Стоимость за одну ночь или за один час, у.е. */
  rate: number
  enabled: boolean
}

export interface NodeLayover {
  mode: LayoverMode
  options: StayOption[]
}

export interface TripNode {
  id: NodeId
  name: string
  coordinates: Coordinates
  region: string
  country: string
  timeZone: string | null
  timeZoneSource: TimeZoneSource
  minimumTransferMinutes: number
  layover: NodeLayover
}

export interface ZonedDateTimeInput {
  /**
   * Локальное время: YYYY-MM-DDTHH:mm.
   * Не содержит Z или UTC offset.
   */
  localDateTime: string
  timeZone: string
  disambiguation: DstDisambiguation
}

export interface TravelOption {
  id: TravelOptionId
  name: string
  descriptionMarkdown: string
  cost: number
  departure: ZonedDateTimeInput
  arrival: ZonedDateTimeInput
  enabled: boolean
}

export interface TripEdge {
  id: EdgeId
  fromNodeId: NodeId
  toNodeId: NodeId
  options: TravelOption[]
}

export interface RouteSearchParameters {
  startNodeId: NodeId | null
  endNodeId: NodeId | null
  earliestDeparture: ZonedDateTimeInput
  optimization: OptimizationMode
}

export interface MapCamera {
  center: Coordinates
  zoom: number
  bearing: number
  pitch: number
}

export type BasemapSettings =
  | {
      kind: 'default'
    }
  | {
      kind: 'raster'
      name: string
      tileUrls: string[]
      attribution: string
      tileSize: 256 | 512
      minZoom: number
      maxZoom: number
    }

export interface TripProject {
  schemaVersion: 2
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodes: TripNode[]
  edges: TripEdge[]
  routeSearch: RouteSearchParameters
  camera: MapCamera
  basemap: BasemapSettings
}

export interface GeocodingResult {
  id: string
  name: string
  displayName: string
  coordinates: Coordinates
  region: string
  country: string
  locality: string | null
}

export interface TimeZoneLookupResult {
  timeZones: string[]
  source: 'automatic'
}

export type ValidationIssueCode =
  | 'missing-name'
  | 'invalid-coordinates'
  | 'invalid-transfer-duration'
  | 'missing-node'
  | 'invalid-edge'
  | 'invalid-cost'
  | 'missing-date-time'
  | 'invalid-date-time'
  | 'missing-time-zone'
  | 'invalid-time-zone'
  | 'ambiguous-date-time'
  | 'nonexistent-date-time'
  | 'arrival-not-after-departure'
  | 'invalid-project'

export interface ValidationIssue {
  code: ValidationIssueCode
  message: string
  field?: string
}

export type ValidationResult<T> =
  | {
      ok: true
      value: T
    }
  | {
      ok: false
      issues: ValidationIssue[]
    }

export interface ResolvedZonedDateTime {
  localDateTime: string
  timeZone: string
  offset: string
  instantIso: string
  epochMilliseconds: number
}

export interface ResolvedTravelOption {
  edgeId: EdgeId
  optionId: TravelOptionId
  fromNodeId: NodeId
  toNodeId: NodeId
  name: string
  cost: number
  departure: ResolvedZonedDateTime
  arrival: ResolvedZonedDateTime
}

export interface StayCharge {
  optionId: string
  optionName: string
  pricing: StayPricing
  rate: number
  /** Ночи (за ночь) или оплаченные часы (за час). */
  units: number
  cost: number
  /** Фактическое пребывание в точке перед следующим рейсом. */
  minutes: number
}

export interface RouteLeg {
  edgeId: EdgeId
  optionId: TravelOptionId
  fromNodeId: NodeId
  toNodeId: NodeId
  optionName: string
  cost: number
  departure: ResolvedZonedDateTime
  arrival: ResolvedZonedDateTime
  travelMinutes: number

  /**
   * Перед первым переездом — ожидание от заданного старта.
   * Перед остальными — интервал от предыдущего прибытия,
   * включая необходимое время пересадки.
   */
  waitingBeforeMinutes: number

  /** Плата за долгую пересадку в точке отправления этого рейса. */
  stayBefore?: StayCharge
}

export interface RouteSummary {
  totalCost: number
  totalTravelMinutes: number
  totalWaitingMinutes: number
  totalDurationMinutes: number
  legCount: number
}

export interface RouteDiagnostics {
  totalOptions: number
  disabledOptions: number
  invalidOptions: number
  usableOptions: number
  issues: Array<{
    edgeId: EdgeId
    optionId: TravelOptionId
    issues: ValidationIssue[]
  }>
}

export type NoRouteReason =
  | 'no-directed-path'
  | 'no-usable-options'
  | 'no-feasible-schedule'

export interface FoundRoute {
  status: 'found'
  calculatedAt: string
  optimization: OptimizationMode
  startNodeId: NodeId
  endNodeId: NodeId
  requestedDeparture: ResolvedZonedDateTime
  arrival: ResolvedZonedDateTime
  legs: RouteLeg[]
  summary: RouteSummary
  diagnostics: RouteDiagnostics
}

export interface FoundRoutes {
  status: 'found'
  calculatedAt: string
  optimization: OptimizationMode
  routes: FoundRoute[]
  diagnostics: RouteDiagnostics
}

export interface MissingRoute {
  status: 'not-found'
  calculatedAt: string
  reason: NoRouteReason
  message: string
  diagnostics: RouteDiagnostics
}

export interface InvalidRouteRequest {
  status: 'invalid-request'
  issues: ValidationIssue[]
}

export type RouteCalculationResult =
  | FoundRoutes
  | MissingRoute
  | InvalidRouteRequest

export interface RouteResultState {
  result: RouteCalculationResult | null
  stale: boolean
}

export type MapSelection =
  | {
      kind: 'none'
    }
  | {
      kind: 'node'
      nodeId: NodeId
    }
  | {
      kind: 'edge'
      edgeId: EdgeId
    }

export interface MapHighlight {
  nodeIds: NodeId[]
  edgeIds: EdgeId[]
}