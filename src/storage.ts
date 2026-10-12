import { createDefaultLayover } from './layover'

import type {
  BasemapSettings,
  DstDisambiguation,
  TripEdge,
  TripNode,
  TripProject,
  StayOption,
  TravelOption,
  ValidationIssue,
  ValidationResult,
  ZonedDateTimeInput,
} from './types'

const STORAGE_KEY = 'trip-sketch.project.v1'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value))
  )
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value })
    return true
  } catch {
    return false
  }
}

export function createId(): string {
  return crypto.randomUUID()
}

export function createEmptyProject(name = 'Новая поездка'): TripProject {
  const now = new Date().toISOString()

  return {
    schemaVersion: 2,
    id: createId(),
    name,
    createdAt: now,
    updatedAt: now,
    nodes: [],
    edges: [],
    routeSearch: {
      startNodeId: null,
      endNodeId: null,
      earliestDeparture: {
        localDateTime: '',
        timeZone: '',
        disambiguation: 'reject',
      },
      optimization: 'cheapest',
    },
    camera: {
      center: { lng: 45, lat: 55 },
      zoom: 4,
      bearing: 0,
      pitch: 0,
    },
    basemap: { kind: 'default' },
  }
}

/**
 * Приводит проект версии 1 к версии 2: у точек появляется
 * обычный режим пересадки без вариантов проживания.
 */
function migrateProject(input: unknown): unknown {
  if (!isObject(input) || input.schemaVersion !== 1) return input

  return {
    ...input,
    schemaVersion: 2,
    nodes: Array.isArray(input.nodes)
      ? input.nodes.map((node: unknown) =>
          isObject(node)
            ? { ...node, layover: createDefaultLayover() }
            : node,
        )
      : input.nodes,
  }
}

export function validateProject(
  rawInput: unknown,
): ValidationResult<TripProject> {
  const input = migrateProject(rawInput)
  const issues: ValidationIssue[] = []

  function issue(field: string, message: string): void {
    issues.push({ code: 'invalid-project', field, message })
  }

  function check(
    condition: boolean,
    field: string,
    message: string,
  ): boolean {
    if (!condition) issue(field, message)
    return condition
  }

  function text(
    object: JsonObject,
    key: string,
    path: string,
    nonEmpty = false,
  ): void {
    check(
      nonEmpty
        ? isNonEmptyString(object[key])
        : typeof object[key] === 'string',
      `${path}.${key}`,
      nonEmpty ? 'Ожидается непустая строка.' : 'Ожидается строка.',
    )
  }

  function coordinates(value: unknown, path: string): void {
    if (!isObject(value)) {
      issue(path, 'Ожидается объект координат.')
      return
    }

    check(
      isFiniteNumber(value.lng) && value.lng >= -180 && value.lng <= 180,
      `${path}.lng`,
      'Долгота должна быть числом от -180 до 180.',
    )

    check(
      isFiniteNumber(value.lat) && value.lat >= -90 && value.lat <= 90,
      `${path}.lat`,
      'Широта должна быть числом от -90 до 90.',
    )
  }

  function zonedDateTime(value: unknown, path: string): void {
    if (!isObject(value)) {
      issue(path, 'Ожидается объект даты и таймзоны.')
      return
    }

    text(value, 'localDateTime', path)
    text(value, 'timeZone', path)

    const allowed: DstDisambiguation[] = ['reject', 'earlier', 'later']

    check(
      allowed.includes(value.disambiguation as DstDisambiguation),
      `${path}.disambiguation`,
      'Допустимые значения: reject, earlier, later.',
    )

    // Незавершённые карточки можно сохранять.
    // Проверка календарной даты и DST выполняется в services.ts.
    if (isNonEmptyString(value.timeZone)) {
      check(
        isValidTimeZone(value.timeZone),
        `${path}.timeZone`,
        'Неизвестная таймзона.',
      )
    }
  }

  function layover(value: unknown, path: string): void {
    if (!isObject(value)) {
      issue(path, 'Ожидается объект пересадки.')
      return
    }

    check(
      value.mode === 'regular' || value.mode === 'extended',
      `${path}.mode`,
      'Допустимые значения: regular, extended.',
    )

    if (!Array.isArray(value.options)) {
      issue(`${path}.options`, 'Ожидается массив вариантов проживания.')
      return
    }

    value.options.forEach((option: unknown, index: number) => {
      const optionPath = `${path}.options[${index}]`

      if (!isObject(option)) {
        issue(optionPath, 'Ожидается объект варианта проживания.')
        return
      }

      text(option, 'id', optionPath, true)
      text(option, 'name', optionPath)
      text(option, 'descriptionMarkdown', optionPath)

      if (isNonEmptyString(option.id)) {
        check(
          !stayIds.has(option.id),
          `${optionPath}.id`,
          'Повторяющийся ID варианта проживания.',
        )
        stayIds.add(option.id)
      }

      check(
        option.pricing === 'per-night' || option.pricing === 'per-hour',
        `${optionPath}.pricing`,
        'Допустимые значения: per-night, per-hour.',
      )

      check(
        isNonNegativeNumber(option.rate),
        `${optionPath}.rate`,
        'Ставка должна быть неотрицательным числом.',
      )

      check(
        typeof option.enabled === 'boolean',
        `${optionPath}.enabled`,
        'Ожидается логическое значение.',
      )
    })
  }

  if (!isObject(input)) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-project',
          message: 'Файл должен содержать объект проекта.',
        },
      ],
    }
  }

  check(
    input.schemaVersion === 2,
    'schemaVersion',
    'Неподдерживаемая версия проекта. Поддерживаются версии 1 и 2.',
  )

  text(input, 'id', 'project', true)
  text(input, 'name', 'project', true)

  check(
    isIsoInstant(input.createdAt),
    'createdAt',
    'Некорректная дата создания.',
  )

  check(
    isIsoInstant(input.updatedAt),
    'updatedAt',
    'Некорректная дата изменения.',
  )

  const nodeIds = new Set<string>()
  const edgeIds = new Set<string>()
  const optionIds = new Set<string>()
  const stayIds = new Set<string>()
  const directedPairs = new Set<string>()

  if (!Array.isArray(input.nodes)) {
    issue('nodes', 'Ожидается массив точек.')
  } else {
    input.nodes.forEach((value: unknown, index: number) => {
      const path = `nodes[${index}]`

      if (!isObject(value)) {
        issue(path, 'Ожидается объект точки.')
        return
      }

      text(value, 'id', path, true)
      text(value, 'name', path, true)
      text(value, 'region', path)
      text(value, 'country', path)
      coordinates(value.coordinates, `${path}.coordinates`)

      if (isNonEmptyString(value.id)) {
        check(!nodeIds.has(value.id), `${path}.id`, 'Повторяющийся ID точки.')
        nodeIds.add(value.id)
      }

      check(
        value.timeZone === null ||
          (isNonEmptyString(value.timeZone) && isValidTimeZone(value.timeZone)),
        `${path}.timeZone`,
        'Ожидается корректная таймзона или null.',
      )

      check(
        ['automatic', 'manual', 'unknown'].includes(
          String(value.timeZoneSource),
        ),
        `${path}.timeZoneSource`,
        'Некорректный источник таймзоны.',
      )

      check(
        isNonNegativeNumber(value.minimumTransferMinutes),
        `${path}.minimumTransferMinutes`,
        'Время пересадки должно быть неотрицательным числом.',
      )

      layover(value.layover, `${path}.layover`)
    })
  }

  if (!Array.isArray(input.edges)) {
    issue('edges', 'Ожидается массив связей.')
  } else {
    input.edges.forEach((value: unknown, index: number) => {
      const path = `edges[${index}]`

      if (!isObject(value)) {
        issue(path, 'Ожидается объект связи.')
        return
      }

      text(value, 'id', path, true)
      text(value, 'fromNodeId', path, true)
      text(value, 'toNodeId', path, true)

      if (isNonEmptyString(value.id)) {
        check(!edgeIds.has(value.id), `${path}.id`, 'Повторяющийся ID связи.')
        edgeIds.add(value.id)
      }

      check(
        typeof value.fromNodeId === 'string' && nodeIds.has(value.fromNodeId),
        `${path}.fromNodeId`,
        'Исходная точка отсутствует.',
      )

      check(
        typeof value.toNodeId === 'string' && nodeIds.has(value.toNodeId),
        `${path}.toNodeId`,
        'Конечная точка отсутствует.',
      )

      check(
        value.fromNodeId !== value.toNodeId,
        path,
        'Связь точки с самой собой не поддерживается.',
      )

      if (
        isNonEmptyString(value.fromNodeId) &&
        isNonEmptyString(value.toNodeId)
      ) {
        const pair = JSON.stringify([value.fromNodeId, value.toNodeId])

        check(
          !directedPairs.has(pair),
          path,
          'Повторяющаяся направленная связь. Добавьте варианты в одну связь.',
        )

        directedPairs.add(pair)
      }

      if (!Array.isArray(value.options)) {
        issue(`${path}.options`, 'Ожидается массив вариантов проезда.')
        return
      }

      value.options.forEach((option: unknown, optionIndex: number) => {
        const optionPath = `${path}.options[${optionIndex}]`

        if (!isObject(option)) {
          issue(optionPath, 'Ожидается объект варианта проезда.')
          return
        }

        text(option, 'id', optionPath, true)
        text(option, 'name', optionPath)
        text(option, 'descriptionMarkdown', optionPath)

        if (isNonEmptyString(option.id)) {
          check(
            !optionIds.has(option.id),
            `${optionPath}.id`,
            'Повторяющийся ID варианта проезда.',
          )
          optionIds.add(option.id)
        }

        check(
          isNonNegativeNumber(option.cost),
          `${optionPath}.cost`,
          'Стоимость должна быть неотрицательным числом.',
        )

        check(
          typeof option.enabled === 'boolean',
          `${optionPath}.enabled`,
          'Ожидается логическое значение.',
        )

        zonedDateTime(option.departure, `${optionPath}.departure`)
        zonedDateTime(option.arrival, `${optionPath}.arrival`)
      })
    })
  }

  if (!isObject(input.routeSearch)) {
    issue('routeSearch', 'Отсутствуют параметры маршрута.')
  } else {
    const search = input.routeSearch

    for (const key of ['startNodeId', 'endNodeId']) {
      check(
        search[key] === null ||
          (typeof search[key] === 'string' && nodeIds.has(search[key])),
        `routeSearch.${key}`,
        'Ожидается ID существующей точки или null.',
      )
    }

    check(
      search.optimization === 'cheapest' ||
        search.optimization === 'earliest-arrival',
      'routeSearch.optimization',
      'Неизвестный критерий оптимизации.',
    )

    zonedDateTime(
      search.earliestDeparture,
      'routeSearch.earliestDeparture',
    )
  }

  if (!isObject(input.camera)) {
    issue('camera', 'Отсутствуют настройки камеры.')
  } else {
    coordinates(input.camera.center, 'camera.center')

    check(
      isFiniteNumber(input.camera.zoom) &&
        input.camera.zoom >= 0 &&
        input.camera.zoom <= 24,
      'camera.zoom',
      'Масштаб должен быть числом от 0 до 24.',
    )

    check(
      isFiniteNumber(input.camera.bearing),
      'camera.bearing',
      'Поворот карты должен быть конечным числом.',
    )

    check(
      isFiniteNumber(input.camera.pitch) &&
        input.camera.pitch >= 0 &&
        input.camera.pitch <= 85,
      'camera.pitch',
      'Наклон карты должен быть числом от 0 до 85.',
    )
  }

  if (!isObject(input.basemap)) {
    issue('basemap', 'Отсутствуют настройки подложки.')
  } else if (input.basemap.kind === 'raster') {
    const basemap = input.basemap

    text(basemap, 'name', 'basemap', true)
    text(basemap, 'attribution', 'basemap')

    check(
      Array.isArray(basemap.tileUrls) &&
        basemap.tileUrls.length > 0 &&
        basemap.tileUrls.every(
          (url: unknown) =>
            typeof url === 'string' && /^https?:\/\//i.test(url),
        ),
      'basemap.tileUrls',
      'Ожидается непустой массив HTTP/HTTPS URL тайлов.',
    )

    check(
      basemap.tileSize === 256 || basemap.tileSize === 512,
      'basemap.tileSize',
      'Размер тайла должен быть 256 или 512.',
    )

    check(
      isFiniteNumber(basemap.minZoom) &&
        isFiniteNumber(basemap.maxZoom) &&
        basemap.minZoom >= 0 &&
        basemap.maxZoom <= 24 &&
        basemap.minZoom <= basemap.maxZoom,
      'basemap',
      'Некорректные границы масштаба подложки.',
    )
  } else {
    check(
      input.basemap.kind === 'default',
      'basemap.kind',
      'Неизвестный тип подложки.',
    )
  }

  if (issues.length > 0) {
    return { ok: false, issues }
  }

  // Собираем новый объект только из предусмотренных схемой полей.
  // Лишние поля импортированного JSON не переносим.
  const nodes = (input.nodes as TripNode[]).map((node): TripNode => ({
    id: node.id,
    name: node.name,
    coordinates: { ...node.coordinates },
    region: node.region,
    country: node.country,
    timeZone: node.timeZone,
    timeZoneSource: node.timeZoneSource,
    minimumTransferMinutes: node.minimumTransferMinutes,
    layover: {
      mode: node.layover.mode,
      options: node.layover.options.map((option): StayOption => ({
        id: option.id,
        name: option.name,
        descriptionMarkdown: option.descriptionMarkdown,
        pricing: option.pricing,
        rate: option.rate,
        enabled: option.enabled,
      })),
    },
  }))

  function copyDateTime(value: ZonedDateTimeInput): ZonedDateTimeInput {
    return {
      localDateTime: value.localDateTime,
      timeZone: value.timeZone,
      disambiguation: value.disambiguation,
    }
  }

  const edges = (input.edges as TripEdge[]).map((edge): TripEdge => ({
    id: edge.id,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    options: edge.options.map((option): TravelOption => ({
      id: option.id,
      name: option.name,
      descriptionMarkdown: option.descriptionMarkdown,
      cost: option.cost,
      departure: copyDateTime(option.departure),
      arrival: copyDateTime(option.arrival),
      enabled: option.enabled,
    })),
  }))

  const validated = input as unknown as TripProject

  const basemap: BasemapSettings =
    validated.basemap.kind === 'default'
      ? { kind: 'default' }
      : {
          kind: 'raster',
          name: validated.basemap.name,
          tileUrls: [...validated.basemap.tileUrls],
          attribution: validated.basemap.attribution,
          tileSize: validated.basemap.tileSize,
          minZoom: validated.basemap.minZoom,
          maxZoom: validated.basemap.maxZoom,
        }

  return {
    ok: true,
    value: {
      schemaVersion: 2,
      id: validated.id,
      name: validated.name,
      createdAt: validated.createdAt,
      updatedAt: validated.updatedAt,
      nodes,
      edges,
      routeSearch: {
        startNodeId: validated.routeSearch.startNodeId,
        endNodeId: validated.routeSearch.endNodeId,
        earliestDeparture: copyDateTime(
          validated.routeSearch.earliestDeparture,
        ),
        optimization: validated.routeSearch.optimization,
      },
      camera: {
        center: { ...validated.camera.center },
        zoom: validated.camera.zoom,
        bearing: validated.camera.bearing,
        pitch: validated.camera.pitch,
      },
      basemap,
    },
  }
}

export function parseProjectJson(
  json: string,
): ValidationResult<TripProject> {
  let input: unknown

  try {
    input = JSON.parse(json)
  } catch {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-project',
          message: 'Файл не является корректным JSON.',
        },
      ],
    }
  }

  return validateProject(input)
}

export function saveProject(
  project: TripProject,
): ValidationResult<TripProject> {
  const validated = validateProject({
    ...project,
    updatedAt: new Date().toISOString(),
  })

  if (!validated.ok) return validated

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated.value))
    return validated
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-project',
          message:
            'Не удалось сохранить проект в браузере: ' +
            errorMessage(error),
        },
      ],
    }
  }
}

export function loadProject(): ValidationResult<TripProject> {
  try {
    const json = localStorage.getItem(STORAGE_KEY)

    if (json === null) {
      return { ok: true, value: createEmptyProject() }
    }

    return parseProjectJson(json)
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-project',
          message:
            'Не удалось прочитать локальный проект: ' +
            errorMessage(error),
        },
      ],
    }
  }
}

export async function importProjectFile(
  file: File,
): Promise<ValidationResult<TripProject>> {
  try {
    return parseProjectJson(await file.text())
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-project',
          message: 'Не удалось прочитать файл: ' + errorMessage(error),
        },
      ],
    }
  }
}

export function exportProject(
  project: TripProject,
): ValidationResult<TripProject> {
  const validated = validateProject(project)

  if (!validated.ok) return validated

  try {
    const json = JSON.stringify(validated.value, null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = createExportFileName(validated.value.name)
    anchor.style.display = 'none'

    document.body.appendChild(anchor)

    try {
      anchor.click()
    } finally {
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    }

    return validated
  } catch (error) {
    return {
      ok: false,
      issues: [
        {
          code: 'invalid-project',
          message: 'Не удалось экспортировать проект: ' + errorMessage(error),
        },
      ],
    }
  }
}

function createExportFileName(name: string): string {
  const safeName = name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100)

  return `${safeName || 'trip-sketch'}-${new Date()
    .toISOString()
    .slice(0, 10)}.json`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}