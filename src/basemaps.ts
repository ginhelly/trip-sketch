import { tileServiceProblem, tileServiceToBasemap } from './settings'

import type { CustomTileService } from './settings'
import type { BasemapSettings } from './types'

export interface BasemapPreset {
  id: string
  label: string
  settings: BasemapSettings
  /** Предупреждение, которое показывается при выборе. */
  warning?: string
}

const OSM_LINK =
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'

export const BASEMAP_PRESETS: readonly BasemapPreset[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    // Подложка по умолчанию, описывается в TripMap.vue.
    settings: { kind: 'default' },
  },
  {
    id: 'osm-de',
    label: 'OpenStreetMap (немецкий сервер)',
    settings: {
      kind: 'raster',
      name: 'OpenStreetMap (немецкий сервер)',
      tileUrls: ['https://tile.openstreetmap.de/{z}/{x}/{y}.png'],
      attribution: `© ${OSM_LINK} contributors`,
      tileSize: 256,
      minZoom: 0,
      maxZoom: 18,
    },
  },
  {
    id: 'google-hybrid',
    label: 'Google Hybrid (спутник и подписи)',
    settings: {
      kind: 'raster',
      name: 'Google Hybrid',
      tileUrls: ['https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}'],
      attribution: 'Map data © Google',
      tileSize: 256,
      minZoom: 0,
      maxZoom: 20,
    },
  },
]

export const CUSTOM_BASEMAP_ID = 'custom'

const USER_PREFIX = 'user:'

/** Все доступные подложки: встроенные и пользовательские. */
export function basemapOptions(
  custom: readonly CustomTileService[],
): BasemapPreset[] {
  const user = custom
    .filter((service) => tileServiceProblem(service) === '')
    .map(
      (service): BasemapPreset => ({
        id: USER_PREFIX + service.id,
        label: service.name.trim(),
        settings: tileServiceToBasemap(service),
      }),
    )

  return [...BASEMAP_PRESETS, ...user]
}

/** Определяет, какой пункт списка соответствует настройкам проекта. */
export function basemapPresetId(
  basemap: BasemapSettings,
  custom: readonly CustomTileService[] = [],
): string {
  if (basemap.kind === 'default') return 'osm'

  const match = basemapOptions(custom).find(
    (item) =>
      item.settings.kind === 'raster' &&
      item.settings.tileUrls[0] === basemap.tileUrls[0],
  )

  return match?.id ?? CUSTOM_BASEMAP_ID
}

/** Независимая копия настроек пункта списка для записи в проект. */
export function basemapFromPreset(
  id: string,
  custom: readonly CustomTileService[] = [],
): BasemapSettings | null {
  const preset = basemapOptions(custom).find((item) => item.id === id)

  return preset
    ? (JSON.parse(JSON.stringify(preset.settings)) as BasemapSettings)
    : null
}
