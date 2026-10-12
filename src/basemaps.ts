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
    }
  },
]

export const CUSTOM_BASEMAP_ID = 'custom'

/** Определяет, какой пресет соответствует настройкам проекта. */
export function basemapPresetId(basemap: BasemapSettings): string {
  if (basemap.kind === 'default') return 'osm'

  const preset = BASEMAP_PRESETS.find(
    (item) =>
      item.settings.kind === 'raster' &&
      item.settings.tileUrls[0] === basemap.tileUrls[0],
  )

  return preset?.id ?? CUSTOM_BASEMAP_ID
}

/** Независимая копия настроек пресета для записи в проект. */
export function basemapFromPreset(id: string): BasemapSettings | null {
  const preset = BASEMAP_PRESETS.find((item) => item.id === id)

  return preset
    ? (JSON.parse(JSON.stringify(preset.settings)) as BasemapSettings)
    : null
}
