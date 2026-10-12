import { describe, expect, it } from 'vitest'

import {
  computeStayCharge,
  countNights,
  LONG_LAYOVER_MINUTES,
} from './layover'

import type { NodeLayover, StayOption } from './types'

const TZ = 'Europe/Moscow'

function at(local: string): number {
  // Europe/Moscow: UTC+3 без перевода часов.
  return Date.parse(`${local}:00+03:00`)
}

function stay(patch: Partial<StayOption> = {}): StayOption {
  return {
    id: 's1',
    name: 'Хостел',
    descriptionMarkdown: '',
    pricing: 'per-night',
    rate: 10,
    enabled: true,
    ...patch,
  }
}

function extended(...options: StayOption[]): NodeLayover {
  return { mode: 'extended', options }
}

describe('countNights', () => {
  it('считает ночь при переходе через полночь', () => {
    expect(
      countNights(at('2026-10-20T23:00'), at('2026-10-21T05:00'), TZ),
    ).toBe(1)
  })

  it('минимум одни сутки без ночёвки', () => {
    expect(
      countNights(at('2026-10-20T10:00'), at('2026-10-20T15:00'), TZ),
    ).toBe(1)
  })

  it('считает несколько ночей', () => {
    expect(
      countNights(at('2026-10-20T10:00'), at('2026-10-22T09:00'), TZ),
    ).toBe(2)
  })

  it('использует календарь таймзоны точки, а не UTC', () => {
    // 22:00 UTC+3 20 октября = 19:00 UTC, 02:00 UTC+3 21 октября = 23:00 UTC:
    // в UTC одна дата, в Москве две.
    expect(
      countNights(at('2026-10-20T22:00'), at('2026-10-21T02:00'), TZ),
    ).toBe(1)
  })
})

describe('computeStayCharge', () => {
  it('обычный режим бесплатен', () => {
    expect(
      computeStayCharge(
        { mode: 'regular', options: [stay()] },
        at('2026-10-20T10:00'),
        at('2026-10-21T10:00'),
        TZ,
      ),
    ).toBeNull()
  })

  it('пересадка ровно в порог не считается долгой', () => {
    const arrival = at('2026-10-20T10:00')
    const departure = arrival + LONG_LAYOVER_MINUTES * 60_000

    expect(
      computeStayCharge(extended(stay()), arrival, departure, TZ),
    ).toBeNull()
  })

  it('минута сверх порога уже долгая', () => {
    const arrival = at('2026-10-20T10:00')
    const departure = arrival + (LONG_LAYOVER_MINUTES + 1) * 60_000

    expect(
      computeStayCharge(extended(stay()), arrival, departure, TZ)?.cost,
    ).toBe(10)
  })

  it('почасовая ставка округляется вверх', () => {
    const charge = computeStayCharge(
      extended(stay({ pricing: 'per-hour', rate: 2 })),
      at('2026-10-20T10:00'),
      at('2026-10-20T14:01'),
      TZ,
    )

    expect(charge).toMatchObject({ units: 5, cost: 10 })
  })

  it('выбирает самый дешёвый вариант для интервала', () => {
    const charge = computeStayCharge(
      extended(
        stay({ id: 'night', rate: 50 }),
        stay({ id: 'hour', pricing: 'per-hour', rate: 3 }),
      ),
      at('2026-10-20T10:00'),
      at('2026-10-20T16:00'),
      TZ,
    )

    // 6 ч × 3 = 18 против 1 ночь × 50.
    expect(charge).toMatchObject({ optionId: 'hour', cost: 18 })
  })

  it('отключённые и некорректные варианты игнорируются', () => {
    expect(
      computeStayCharge(
        extended(
          stay({ enabled: false }),
          stay({ id: 'bad', rate: Number.NaN }),
        ),
        at('2026-10-20T10:00'),
        at('2026-10-21T10:00'),
        TZ,
      ),
    ).toBeNull()
  })
})
