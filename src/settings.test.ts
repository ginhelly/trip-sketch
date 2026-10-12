import { describe, expect, it } from 'vitest'

import { basemapFromPreset, basemapOptions, basemapPresetId } from './basemaps'
import { parseNominatimBody } from './services'
import {
  defaultSettings,
  isValidTileUrl,
  normalizeSettings,
  tileServiceProblem,
  tileServiceToBasemap,
} from './settings'


describe('настройки', () => {
  it('по умолчанию три варианта маршрута, перетаскивание и Photon', () => {
    expect(defaultSettings()).toEqual({
      customTileServices: [],
      maxRoutes: 3,
      allowNodeDragging: true,
      geocoder: 'photon',
    })
  })

  it('нормализует мусор и ограничивает число вариантов', () => {
    expect(normalizeSettings('мусор')).toEqual(defaultSettings())

    expect(normalizeSettings({ maxRoutes: 99 }).maxRoutes).toBe(10)
    expect(normalizeSettings({ maxRoutes: 0 }).maxRoutes).toBe(1)
    expect(normalizeSettings({ maxRoutes: 2.5 }).maxRoutes).toBe(3)
    expect(normalizeSettings({ geocoder: 'bing' }).geocoder).toBe('photon')
    expect(normalizeSettings({ geocoder: 'nominatim' }).geocoder).toBe(
      'nominatim',
    )

    const kept = normalizeSettings({
      customTileServices: [
        { id: 'a', name: 'A', url: 'https://x/{z}/{x}/{y}.png' },
        { id: 5 },
        null,
      ],
    })

    expect(kept.customTileServices).toHaveLength(1)
    expect(kept.customTileServices[0]!.maxZoom).toBe(19)
  })
})

describe('пользовательские тайлы', () => {
  const service = {
    id: 'u1',
    name: 'Мой сервис',
    url: 'https://tiles.example.com/{z}/{x}/{y}.png',
    attribution: '© <b>автор</b>',
    maxZoom: 17,
  }

  it('проверяет адрес', () => {
    expect(isValidTileUrl(service.url)).toBe(true)
    expect(isValidTileUrl('https://example.com/tiles.png')).toBe(false)
    expect(isValidTileUrl('ftp://example.com/{z}/{x}/{y}')).toBe(false)
    expect(tileServiceProblem({ ...service, name: ' ' })).not.toBe('')
    expect(tileServiceProblem(service)).toBe('')
  })

  it('экранирует атрибуцию и попадает в список подложек', () => {
    const basemap = tileServiceToBasemap(service)

    expect(basemap.kind === 'raster' && basemap.attribution).toBe(
      '© &lt;b&gt;автор&lt;/b&gt;',
    )

    const options = basemapOptions([service])
    expect(options.map((item) => item.id)).toContain('user:u1')

    const id = basemapPresetId(basemap, [service])
    expect(id).toBe('user:u1')
    expect(basemapFromPreset(id, [service])).toEqual(basemap)
  })

  it('некорректные сервисы в список не попадают', () => {
    const options = basemapOptions([{ ...service, url: 'нет' }])
    expect(options.some((item) => item.id.startsWith('user:'))).toBe(false)
  })
})

describe('Nominatim', () => {
  it('разбирает ответ поиска', () => {
    const results = parseNominatimBody([
      {
        osm_type: 'relation',
        osm_id: 123,
        lat: '55.79',
        lon: '49.12',
        name: 'Казань',
        display_name: 'Казань, Татарстан, Россия',
        address: { city: 'Казань', state: 'Татарстан', country: 'Россия' },
      },
      { lat: 'x', lon: 'y' },
    ])

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'relation:123',
      name: 'Казань',
      region: 'Татарстан',
      country: 'Россия',
      locality: 'Казань',
      coordinates: { lng: 49.12, lat: 55.79 },
    })
  })

  it('разбирает обратное геокодирование и отсутствие места', () => {
    expect(
      parseNominatimBody({
        lat: '55.1',
        lon: '47.2',
        display_name: 'Урмары, Чувашия, Россия',
        address: { village: 'Урмары', state: 'Чувашия', country: 'Россия' },
      })[0]!.name,
    ).toBe('Урмары')

    expect(parseNominatimBody({ error: 'Unable to geocode' })).toEqual([])
  })
})
