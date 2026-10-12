import type { GeocoderProvider } from './services'
import type { BasemapSettings } from './types'

export type { GeocoderProvider }

/**
 * Настройки сервиса относятся к браузеру пользователя, а не к проекту:
 * в JSON проекта они не попадают.
 */

const SETTINGS_KEY = 'trip-sketch.settings.v1'

export const GEOCODER_LABELS: Record<GeocoderProvider, string> = {
  photon: 'Photon (komoot)',
  nominatim: 'Nominatim (OpenStreetMap)',
}

export interface CustomTileService {
  id: string
  name: string
  /** Шаблон адреса тайла с {x}, {y} и {z}. */
  url: string
  attribution: string
  maxZoom: number
}

export interface AppSettings {
  customTileServices: CustomTileService[]
  /** Сколько вариантов маршрута показывать. */
  maxRoutes: number
  allowNodeDragging: boolean
  geocoder: GeocoderProvider
}

export const MIN_ROUTES = 1
export const MAX_ROUTES_LIMIT = 10
export const DEFAULT_MAX_ROUTES = 3

export function defaultSettings(): AppSettings {
  return {
    customTileServices: [],
    maxRoutes: DEFAULT_MAX_ROUTES,
    allowNodeDragging: true,
    geocoder: 'photon',
  }
}

export function isValidTileUrl(url: string): boolean {
  const trimmed = url.trim()

  return (
    /^https?:\/\//i.test(trimmed) &&
    trimmed.includes('{x}') &&
    trimmed.includes('{y}') &&
    trimmed.includes('{z}')
  )
}

/** Текст проблемы с сервисом или пустая строка, если всё в порядке. */
export function tileServiceProblem(service: CustomTileService): string {
  if (!service.name.trim()) return 'Укажите название.'

  if (!isValidTileUrl(service.url)) {
    return 'Адрес должен начинаться с http:// или https:// и содержать {x}, {y} и {z}.'
  }

  if (
    !Number.isFinite(service.maxZoom) ||
    service.maxZoom < 1 ||
    service.maxZoom > 24
  ) {
    return 'Максимальный масштаб: число от 1 до 24.'
  }

  return ''
}

export function tileServiceToBasemap(
  service: CustomTileService,
): BasemapSettings {
  return {
    kind: 'raster',
    name: service.name.trim(),
    tileUrls: [service.url.trim()],
    attribution: escapeHtml(service.attribution.trim()),
    tileSize: 256,
    minZoom: 0,
    maxZoom: Math.round(service.maxZoom),
  }
}

// MapLibre выводит атрибуцию как HTML, поэтому пользовательский текст
// экранируется.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Приводит прочитанное из хранилища к корректным настройкам. */
export function normalizeSettings(input: unknown): AppSettings {
  const result = defaultSettings()

  if (!isObject(input)) return result

  if (
    typeof input.maxRoutes === 'number' &&
    Number.isInteger(input.maxRoutes)
  ) {
    result.maxRoutes = Math.min(
      MAX_ROUTES_LIMIT,
      Math.max(MIN_ROUTES, input.maxRoutes),
    )
  }

  if (typeof input.allowNodeDragging === 'boolean') {
    result.allowNodeDragging = input.allowNodeDragging
  }

  if (input.geocoder === 'photon' || input.geocoder === 'nominatim') {
    result.geocoder = input.geocoder
  }

  if (Array.isArray(input.customTileServices)) {
    for (const item of input.customTileServices) {
      if (!isObject(item)) continue

      if (
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.url === 'string'
      ) {
        result.customTileServices.push({
          id: item.id,
          name: item.name,
          url: item.url,
          attribution:
            typeof item.attribution === 'string' ? item.attribution : '',
          maxZoom:
            typeof item.maxZoom === 'number' && Number.isFinite(item.maxZoom)
              ? item.maxZoom
              : 19,
        })
      }
    }
  }

  return result
}

export function loadSettings(): AppSettings {
  try {
    const json = localStorage.getItem(SETTINGS_KEY)

    return json === null
      ? defaultSettings()
      : normalizeSettings(JSON.parse(json))
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  } catch {
    // Настройки не критичны: без хранилища они живут до перезагрузки.
  }
}
