import { Temporal } from '@js-temporal/polyfill'

import tzLookup from '@photostructure/tz-lookup'

import type {
  Coordinates,
  GeocodingResult,
  ResolvedTravelOption,
  ResolvedZonedDateTime,
  TripEdge,
  TripNode,
  TravelOption,
  ValidationIssue,
  ValidationResult,
  ZonedDateTimeInput,
} from './types'

const DEFAULT_PHOTON_URL = 'https://photon.komoot.io'
const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org'
const REQUEST_TIMEOUT_MS = 12_000
const MAX_CACHE_ENTRIES = 100

const geocodingCache = new Map<string, GeocodingResult[]>()

export type GeocoderProvider = 'photon' | 'nominatim'

export interface GeocodingOptions {
  provider?: GeocoderProvider
  baseUrl?: string
  signal?: AbortSignal
  limit?: number
  bias?: Coordinates
}

interface PhotonFeature {
  type?: string
  geometry?: {
    type?: string
    coordinates?: unknown[]
  }
  properties?: Record<string, unknown>
}

function failure<T>(
  code: ValidationIssue['code'],
  message: string,
  field?: string,
): ValidationResult<T> {
  return {
    ok: false,
    issues: [{ code, message, ...(field ? { field } : {}) }],
  }
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.trim()) return false

  try {
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch {
    return false
  }
}

export function getSuggestedTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[]
  }

  const fallback = [
    'Europe/Amsterdam',
    'Europe/Moscow',
    'Europe/Samara',
    'Asia/Yekaterinburg',
    'Asia/Omsk',
    'Asia/Novosibirsk',
    'Asia/Krasnoyarsk',
    'Asia/Irkutsk',
    'Asia/Yakutsk',
    'Asia/Vladivostok',
    'Asia/Magadan',
    'Asia/Kamchatka',
  ]

  const zones = intl.supportedValuesOf
    ? intl.supportedValuesOf('timeZone')
    : fallback

  return [...new Set(['UTC', ...zones])].sort()
}

export function resolveZonedDateTime(
  input: ZonedDateTimeInput,
  field = 'dateTime',
): ValidationResult<ResolvedZonedDateTime> {
  if (!input.localDateTime.trim()) {
    return failure(
      'missing-date-time',
      'Укажите дату и время.',
      `${field}.localDateTime`,
    )
  }

  if (!input.timeZone.trim()) {
    return failure(
      'missing-time-zone',
      'Выберите таймзону.',
      `${field}.timeZone`,
    )
  }

  if (!isValidTimeZone(input.timeZone)) {
    return failure(
      'invalid-time-zone',
      'Неизвестная таймзона.',
      `${field}.timeZone`,
    )
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.localDateTime)) {
    return failure(
      'invalid-date-time',
      'Ожидается локальная дата в формате YYYY-MM-DDTHH:mm.',
      `${field}.localDateTime`,
    )
  }

  if (!['reject', 'earlier', 'later'].includes(input.disambiguation)) {
    return failure(
      'invalid-date-time',
      'Некорректный выбор смещения времени.',
      `${field}.disambiguation`,
    )
  }

  let plain: Temporal.PlainDateTime

  try {
    plain = Temporal.PlainDateTime.from(input.localDateTime, {
      overflow: 'reject',
    })
  } catch {
    return failure(
      'invalid-date-time',
      'Некорректная календарная дата или время.',
      `${field}.localDateTime`,
    )
  }

  try {
    const earlier = plain.toZonedDateTime(input.timeZone, {
      disambiguation: 'earlier',
    })

    const later = plain.toZonedDateTime(input.timeZone, {
      disambiguation: 'later',
    })

    const earlierMatches = earlier.toPlainDateTime().equals(plain)
    const laterMatches = later.toPlainDateTime().equals(plain)

    if (!earlierMatches || !laterMatches) {
      return failure(
        'nonexistent-date-time',
        'Это локальное время не существует из-за перевода часов. Выберите другое время.',
        `${field}.localDateTime`,
      )
    }

    const ambiguous =
      earlier.epochMilliseconds !== later.epochMilliseconds

    if (ambiguous && input.disambiguation === 'reject') {
      return failure(
        'ambiguous-date-time',
        `Время встречается дважды. Выберите ранний offset ${earlier.offset} или поздний ${later.offset}.`,
        `${field}.disambiguation`,
      )
    }

    const resolved =
      ambiguous && input.disambiguation === 'later' ? later : earlier

    return {
      ok: true,
      value: {
        localDateTime: input.localDateTime,
        timeZone: input.timeZone,
        offset: resolved.offset,
        instantIso: resolved.toInstant().toString(),
        epochMilliseconds: resolved.epochMilliseconds,
      },
    }
  } catch {
    return failure(
      'invalid-date-time',
      'Не удалось преобразовать дату с указанной таймзоной.',
      field,
    )
  }
}

export function validateTravelOption(
  edge: TripEdge,
  option: TravelOption,
  nodes: readonly TripNode[],
): ValidationResult<ResolvedTravelOption> {
  const issues: ValidationIssue[] = []
  const prefix = `edges.${edge.id}.options.${option.id}`

  const fromExists = nodes.some((node) => node.id === edge.fromNodeId)
  const toExists = nodes.some((node) => node.id === edge.toNodeId)

  if (!fromExists || !toExists) {
    issues.push({
      code: 'missing-node',
      message: 'Одна из точек связи отсутствует.',
      field: `edges.${edge.id}`,
    })
  }

  if (edge.fromNodeId === edge.toNodeId) {
    issues.push({
      code: 'invalid-edge',
      message: 'Связь точки с самой собой не поддерживается.',
      field: `edges.${edge.id}`,
    })
  }

  if (!option.name.trim()) {
    issues.push({
      code: 'missing-name',
      message: 'Укажите название варианта проезда.',
      field: `${prefix}.name`,
    })
  }

  if (!Number.isFinite(option.cost) || option.cost < 0) {
    issues.push({
      code: 'invalid-cost',
      message: 'Стоимость должна быть конечным неотрицательным числом.',
      field: `${prefix}.cost`,
    })
  }

  const departure = resolveZonedDateTime(
    option.departure,
    `${prefix}.departure`,
  )

  const arrival = resolveZonedDateTime(
    option.arrival,
    `${prefix}.arrival`,
  )

  if (!departure.ok) issues.push(...departure.issues)
  if (!arrival.ok) issues.push(...arrival.issues)

  if (
    departure.ok &&
    arrival.ok &&
    arrival.value.epochMilliseconds <= departure.value.epochMilliseconds
  ) {
    issues.push({
      code: 'arrival-not-after-departure',
      message: 'Прибытие должно быть позже отправления по абсолютному времени.',
      field: `${prefix}.arrival`,
    })
  }

  if (issues.length > 0 || !departure.ok || !arrival.ok) {
    return { ok: false, issues }
  }

  return {
    ok: true,
    value: {
      edgeId: edge.id,
      optionId: option.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      name: option.name,
      cost: option.cost,
      departure: departure.value,
      arrival: arrival.value,
    },
  }
}

export function localDateTimeAt(
  epochMilliseconds: number,
  timeZone: string,
): string {
  return Temporal.Instant.fromEpochMilliseconds(epochMilliseconds)
    .toZonedDateTimeISO(timeZone)
    .toPlainDateTime()
    .toString({ smallestUnit: 'minute' })
}

export function formatResolvedDateTime(
  value: ResolvedZonedDateTime,
): string {
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    timeZone: value.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value.epochMilliseconds)

  return `${formatted} · ${value.timeZone} · UTC${value.offset}`
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) return '—'

  const total = Math.round(minutes)
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const remainder = total % 60

  const parts: string[] = []

  if (days) parts.push(`${days} д`)
  if (hours) parts.push(`${hours} ч`)
  if (remainder || parts.length === 0) parts.push(`${remainder} мин`)

  return parts.join(' ')
}

export async function searchPlaces(
  query: string,
  options: GeocodingOptions = {},
): Promise<GeocodingResult[]> {
  const trimmed = query.trim()

  if (trimmed.length < 2) return []

  if (options.provider === 'nominatim') {
    const url = createServiceUrl(DEFAULT_NOMINATIM_URL, 'search', options.baseUrl)
    url.searchParams.set('q', trimmed)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('accept-language', 'ru,en')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('limit', String(normalizeLimit(options.limit)))

    if (options.bias && validCoordinates(options.bias)) {
      // Подсказка: сначала результаты рядом с центром карты.
      const { lng, lat } = options.bias
      url.searchParams.set(
        'viewbox',
        `${lng - 2},${lat + 2},${lng + 2},${lat - 2}`,
      )
    }

    return requestPlaces(url, options.signal, parseNominatimBody)
  }

  const url = createServiceUrl(DEFAULT_PHOTON_URL, 'api/', options.baseUrl)
  url.searchParams.set('q', trimmed)
  url.searchParams.set('limit', String(normalizeLimit(options.limit)))

  if (options.bias && validCoordinates(options.bias)) {
    url.searchParams.set('lon', String(options.bias.lng))
    url.searchParams.set('lat', String(options.bias.lat))
  }

  return requestPlaces(url, options.signal, parsePhotonBody)
}

export async function reverseGeocode(
  coordinates: Coordinates,
  options: GeocodingOptions = {},
): Promise<GeocodingResult[]> {
  if (!validCoordinates(coordinates)) {
    throw new Error('Некорректные координаты точки.')
  }

  if (options.provider === 'nominatim') {
    const url = createServiceUrl(DEFAULT_NOMINATIM_URL, 'reverse', options.baseUrl)
    url.searchParams.set('lon', String(coordinates.lng))
    url.searchParams.set('lat', String(coordinates.lat))
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('accept-language', 'ru,en')
    url.searchParams.set('addressdetails', '1')

    return requestPlaces(url, options.signal, parseNominatimBody)
  }

  const url = createServiceUrl(DEFAULT_PHOTON_URL, 'reverse', options.baseUrl)
  url.searchParams.set('lon', String(coordinates.lng))
  url.searchParams.set('lat', String(coordinates.lat))
  url.searchParams.set('limit', String(normalizeLimit(options.limit ?? 3)))

  return requestPlaces(url, options.signal, parsePhotonBody)
}

function createServiceUrl(
  defaultBase: string,
  path: string,
  baseUrl?: string,
): URL {
  const base = (baseUrl || defaultBase).replace(/\/+$/, '')
  const url = new URL(`${base}/${path}`)

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Геокодер должен использовать HTTP или HTTPS.')
  }

  return url
}

function normalizeLimit(limit = 6): number {
  if (!Number.isFinite(limit)) return 6
  return Math.max(1, Math.min(10, Math.floor(limit)))
}

function validCoordinates(value: Coordinates): boolean {
  return (
    Number.isFinite(value.lng) &&
    Number.isFinite(value.lat) &&
    value.lng >= -180 &&
    value.lng <= 180 &&
    value.lat >= -90 &&
    value.lat <= 90
  )
}

function copyResults(results: GeocodingResult[]): GeocodingResult[] {
  return results.map((result) => ({
    ...result,
    coordinates: { ...result.coordinates },
  }))
}

async function requestPlaces(
  url: URL,
  externalSignal: AbortSignal | undefined,
  parse: (body: unknown) => GeocodingResult[],
): Promise<GeocodingResult[]> {
  if (externalSignal?.aborted) {
    throw new DOMException('Запрос отменён.', 'AbortError')
  }

  const key = url.toString()
  const cached = geocodingCache.get(key)

  if (cached) return copyResults(cached)

  const controller = new AbortController()
  let timedOut = false

  const onAbort = (): void => controller.abort()

  externalSignal?.addEventListener('abort', onAbort, { once: true })

  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Геокодер ограничил частоту запросов. Попробуйте позже.')
      }

      throw new Error(`Ошибка геокодера: HTTP ${response.status}.`)
    }

    const body: unknown = await response.json()
    const results = parse(body)

    if (geocodingCache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = geocodingCache.keys().next().value
      if (oldestKey !== undefined) geocodingCache.delete(oldestKey)
    }

    geocodingCache.set(key, results)
    return copyResults(results)
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new DOMException('Запрос отменён.', 'AbortError')
    }

    if (timedOut) {
      throw new Error('Геокодер не ответил вовремя. Попробуйте ещё раз.')
    }

    if (error instanceof TypeError) {
      throw new Error(
        'Не удалось подключиться к геокодеру. Проверьте сеть и доступность сервера.',
      )
    }

    throw error
  } finally {
    window.clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', onAbort)
  }
}

function parsePhotonBody(body: unknown): GeocodingResult[] {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('features' in body) ||
    !Array.isArray(body.features)
  ) {
    throw new Error('Геокодер вернул неожиданный формат данных.')
  }

  const results: GeocodingResult[] = []
  const seen = new Set<string>()

  for (const feature of body.features) {
    const result = parsePhotonFeature(feature)

    if (result && !seen.has(result.id)) {
      results.push(result)
      seen.add(result.id)
    }
  }

  return results
}

/**
 * Nominatim: поиск возвращает массив, обратное геокодирование — объект
 * (или объект с полем error, если места нет).
 */
export function parseNominatimBody(body: unknown): GeocodingResult[] {
  if (typeof body !== 'object' || body === null) {
    throw new Error('Геокодер вернул неожиданный формат данных.')
  }

  if (!Array.isArray(body) && 'error' in body) return []

  const items: unknown[] = Array.isArray(body) ? body : [body]
  const results: GeocodingResult[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const result = parseNominatimItem(item)

    if (result && !seen.has(result.id)) {
      results.push(result)
      seen.add(result.id)
    }
  }

  return results
}

function parseNominatimItem(input: unknown): GeocodingResult | null {
  if (typeof input !== 'object' || input === null) return null

  const item = input as Record<string, unknown>
  const lng = Number(item.lon)
  const lat = Number(item.lat)
  const coordinates = { lng, lat }

  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
  if (!validCoordinates(coordinates)) return null

  const address =
    typeof item.address === 'object' &&
    item.address !== null &&
    !Array.isArray(item.address)
      ? (item.address as Record<string, unknown>)
      : {}

  function text(source: Record<string, unknown>, key: string): string {
    const value = source[key]
    return typeof value === 'string' ? value.trim() : ''
  }

  const locality =
    text(address, 'city') ||
    text(address, 'town') ||
    text(address, 'village') ||
    text(address, 'hamlet') ||
    text(address, 'municipality')

  const streetAddress = [text(address, 'road'), text(address, 'house_number')]
    .filter(Boolean)
    .join(' ')

  const displayFirst = text(item, 'display_name').split(',')[0]?.trim() ?? ''

  const name =
    text(item, 'name') ||
    streetAddress ||
    locality ||
    displayFirst ||
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`

  const region = text(address, 'state') || text(address, 'county')
  const country = text(address, 'country')

  const displayName = [...new Set([name, locality, region, country])]
    .filter(Boolean)
    .join(', ')

  const osmId = item.osm_id
  const osmType = text(item, 'osm_type')

  const id =
    typeof osmId === 'number' || typeof osmId === 'string'
      ? `${osmType || 'osm'}:${osmId}`
      : `${lng}:${lat}:${name}`

  return {
    id,
    name,
    displayName,
    coordinates,
    region,
    country,
    locality: locality || null,
  }
}

function parsePhotonFeature(input: unknown): GeocodingResult | null {
  if (typeof input !== 'object' || input === null) return null

  const feature = input as PhotonFeature

  if (
    feature.geometry?.type !== 'Point' ||
    !Array.isArray(feature.geometry.coordinates)
  ) {
    return null
  }

  const [lng, lat] = feature.geometry.coordinates

  if (typeof lng !== 'number' || typeof lat !== 'number') return null

  const coordinates = { lng, lat }
  if (!validCoordinates(coordinates)) return null

  const properties = feature.properties

  if (
    typeof properties !== 'object' ||
    properties === null ||
    Array.isArray(properties)
  ) {
    return null
  }

  function text(key: string): string {
    const value = properties![key]
    return typeof value === 'string' ? value.trim() : ''
  }

  const locality =
    text('city') ||
    text('town') ||
    text('village') ||
    text('hamlet') ||
    text('locality')

  const streetAddress = [text('street'), text('housenumber')]
    .filter(Boolean)
    .join(' ')

  const name =
    text('name') ||
    streetAddress ||
    locality ||
    text('district') ||
    `${lat.toFixed(5)}, ${lng.toFixed(5)}`

  const region = text('state') || text('county')
  const country = text('country')

  const displayName = [...new Set([name, locality, region, country])]
    .filter(Boolean)
    .join(', ')

  const osmId = properties.osm_id
  const osmType = text('osm_type')

  const id =
    typeof osmId === 'number' || typeof osmId === 'string'
      ? `${osmType || 'osm'}:${osmId}`
      : `${lng}:${lat}:${name}`

  return {
    id,
    name,
    displayName,
    coordinates,
    region,
    country,
    locality: locality || null,
  }
}

const timeZoneCache = new Map<string, string[]>()

export async function lookupTimeZones(
  coordinates: Coordinates,
): Promise<string[]> {
  if (!validCoordinates(coordinates)) {
    throw new Error('Некорректные координаты для определения таймзоны.')
  }

  const key = `${coordinates.lat}:${coordinates.lng}`
  const cached = timeZoneCache.get(key)

  if (cached) return [...cached]

  // Данные зон встроены в библиотеку: внешних запросов нет.
  // Возвращается ровно одна зона.
  let zone: unknown

  try {
    zone = tzLookup(coordinates.lat, coordinates.lng)
  } catch {
    zone = null
  }

  if (typeof zone !== 'string' || !isValidTimeZone(zone)) {
    throw new Error('Не удалось определить таймзону точки.')
  }

  const timeZones = [zone]

  timeZoneCache.set(key, timeZones)

  return [...timeZones]
}