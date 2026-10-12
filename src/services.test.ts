import { describe, expect, it } from 'vitest'

import { lookupTimeZones } from './services'

describe('lookupTimeZones', () => {
  it('определяет таймзону по координатам без сети', async () => {
    expect(await lookupTimeZones({ lng: 37.62, lat: 55.75 })).toEqual([
      'Europe/Moscow',
    ])

    expect(await lookupTimeZones({ lng: 60.6, lat: 56.84 })).toEqual([
      'Asia/Yekaterinburg',
    ])

    expect(await lookupTimeZones({ lng: 139.69, lat: 35.69 })).toEqual([
      'Asia/Tokyo',
    ])
  })

  it('отклоняет некорректные координаты', async () => {
    await expect(lookupTimeZones({ lng: 200, lat: 0 })).rejects.toThrow()
  })
})
