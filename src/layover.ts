import { Temporal } from '@js-temporal/polyfill'

import type {
  NodeLayover,
  StayCharge,
  StayOption,
} from './types'

/** Пересадка дольше этого порога считается долгой. */
export const LONG_LAYOVER_MINUTES = 180

export function createDefaultLayover(): NodeLayover {
  return { mode: 'regular', options: [] }
}

export function isUsableStayOption(option: StayOption): boolean {
  return (
    option.enabled &&
    Number.isFinite(option.rate) &&
    option.rate >= 0
  )
}

/**
 * Число ночей между прибытием и отправлением по местному календарю
 * точки. Не меньше 1: даже без ночёвки оплачивается минимум один день.
 */
export function countNights(
  arrivalMs: number,
  departureMs: number,
  timeZone: string,
): number {
  const arrivalDate = Temporal.Instant.fromEpochMilliseconds(arrivalMs)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()

  const departureDate = Temporal.Instant.fromEpochMilliseconds(departureMs)
    .toZonedDateTimeISO(timeZone)
    .toPlainDate()

  return Math.max(1, departureDate.since(arrivalDate).days)
}

function chargeFor(
  option: StayOption,
  arrivalMs: number,
  departureMs: number,
  timeZone: string,
): StayCharge {
  const minutes = (departureMs - arrivalMs) / 60_000

  const units =
    option.pricing === 'per-hour'
      ? Math.ceil(minutes / 60)
      : countNights(arrivalMs, departureMs, timeZone)

  return {
    optionId: option.id,
    optionName: option.name,
    pricing: option.pricing,
    rate: option.rate,
    units,
    cost: units * option.rate,
    minutes,
  }
}

/**
 * Плата за пребывание в точке между прибытием и следующим отправлением.
 * null — пересадка не долгая, точка в обычном режиме
 * или нет подходящих вариантов (тогда пребывание бесплатно).
 * Из нескольких вариантов выбирается самый дешёвый,
 * при равенстве — первый в списке.
 */
export function computeStayCharge(
  layover: NodeLayover,
  arrivalMs: number,
  departureMs: number,
  timeZone: string,
): StayCharge | null {
  if (layover.mode !== 'extended') return null

  const minutes = (departureMs - arrivalMs) / 60_000

  if (minutes <= LONG_LAYOVER_MINUTES) return null

  let best: StayCharge | null = null

  for (const option of layover.options) {
    if (!isUsableStayOption(option)) continue

    const charge = chargeFor(option, arrivalMs, departureMs, timeZone)

    if (best === null || charge.cost < best.cost) {
      best = charge
    }
  }

  return best
}
