<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

import TripMap from './components/TripMap.vue'

import {
  createEmptyProject,
  createId,
  exportProject,
  importProjectFile,
  loadProject,
  saveProject,
} from './storage'

import {
  formatDuration,
  formatResolvedDateTime,
  getSuggestedTimeZones,
  localDateTimeAt,
  resolveZonedDateTime,
  reverseGeocode,
  searchPlaces,
  validateTravelOption,
  lookupTimeZones,
} from './services'

import { calculateRoute } from './routing'

import type {
  Coordinates,
  EditorMode,
  GeocodingResult,
  MapCamera,
  MapHighlight,
  MapSelection,
  RouteResultState,
  TravelOption,
  TripNode,
  TripProject,
  ValidationIssue,
} from './types'

const loaded = loadProject()

const project = ref<TripProject>(
  loaded.ok ? loaded.value : createEmptyProject(),
)

const storageBlocked = ref(!loaded.ok)
const storageMessage = ref(
  loaded.ok
    ? 'Проект загружен'
    : `Автосохранение отключено: ${loaded.issues
        .map((issue) => issue.message)
        .join(' ')}`,
)

const mode = ref<EditorMode>('select')
const selection = ref<MapSelection>({ kind: 'none' })
const pendingFromNodeId = ref<string | null>(null)

const routeState = ref<RouteResultState>({
  result: null,
  stale: false,
})

const mapRef = ref<InstanceType<typeof TripMap> | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const notice = ref('')
const mapError = ref('')

const searchQuery = ref('')
const searchResults = ref<GeocodingResult[]>([])
const searchBusy = ref(false)
const searchError = ref('')
const reverseBusyCount = ref(0)
const edgeDialogOpen = ref(false)

const timeZones = getSuggestedTimeZones()
const timeFields = ['departure', 'arrival'] as const
const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

let saveTimer: ReturnType<typeof setTimeout> | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
let searchController: AbortController | null = null
let searchVersion = 0
let alive = true

const reverseControllers = new Set<AbortController>()
const nodeLookupVersions = new Map<string, number>()

const selectedNode = computed(() => {
  const current = selection.value

  return current.kind === 'node'
    ? project.value.nodes.find((node) => node.id === current.nodeId) ?? null
    : null
})

const selectedEdge = computed(() => {
  const current = selection.value

  return current.kind === 'edge'
    ? project.value.edges.find((edge) => edge.id === current.edgeId) ?? null
    : null
})

const highlight = computed<MapHighlight | null>(() => {
  const result = routeState.value.result

  if (routeState.value.stale || result?.status !== 'found') return null

  return {
    edgeIds: [...new Set(result.legs.map((leg) => leg.edgeId))],
    nodeIds: [
      ...new Set([
        result.startNodeId,
        ...result.legs.map((leg) => leg.toNodeId),
      ]),
    ],
  }
})

const selectedEdgeTitle = computed(() => {
  const edge = selectedEdge.value

  return edge
    ? `${nodeName(edge.fromNodeId)} → ${nodeName(edge.toNodeId)}`
    : ''
})

function nodeName(nodeId: string): string {
  return (
    project.value.nodes.find((node) => node.id === nodeId)?.name ??
    'Неизвестная точка'
  )
}

function issuesText(issues: ValidationIssue[]): string {
  return issues.map((issue) => issue.message).join(' ')
}

function saveNow(): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  if (storageBlocked.value) return

  const result = saveProject(project.value)

  if (result.ok) {
    storageMessage.value =
      `Сохранено ${new Date().toLocaleTimeString('ru-RU')}`
  } else {
    storageMessage.value = `Не сохранено: ${issuesText(result.issues)}`
  }
}

function scheduleSave(): void {
  if (storageBlocked.value) return

  if (saveTimer !== undefined) clearTimeout(saveTimer)

  storageMessage.value = 'Сохранение…'
  saveTimer = setTimeout(saveNow, 500)
}

watch(project, scheduleSave, { deep: true })

watch(
  () => [
    project.value.nodes,
    project.value.edges,
    project.value.routeSearch,
  ],
  () => {
    if (routeState.value.result !== null) {
      routeState.value.stale = true
    }
  },
  { deep: true, flush: 'sync' },
)

function setMode(next: EditorMode): void {
  mode.value = next
  pendingFromNodeId.value = null
}

function selectNode(nodeId: string): void {
  if (mode.value !== 'add-edge') {
    selection.value = { kind: 'node', nodeId }
    return
  }

  if (pendingFromNodeId.value === null) {
    pendingFromNodeId.value = nodeId
    selection.value = { kind: 'node', nodeId }
    return
  }

  const fromNodeId = pendingFromNodeId.value

  if (fromNodeId === nodeId) {
    notice.value = 'Выберите другую точку для конца связи.'
    return
  }

  let edge = project.value.edges.find(
    (item) =>
      item.fromNodeId === fromNodeId &&
      item.toNodeId === nodeId,
  )

  if (!edge) {
    edge = {
      id: createId(),
      fromNodeId,
      toNodeId: nodeId,
      options: [],
    }

    project.value.edges.push(edge)
  }

  selectEdge(edge.id)
  notice.value = ''
}

function closeEdgeDialog(): void {
  edgeDialogOpen.value = false
}

function handleDialogKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && edgeDialogOpen.value) {
    event.preventDefault()
    closeEdgeDialog()
  }
}

window.addEventListener('keydown', handleDialogKeydown)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleDialogKeydown)
})

watch(
  () => selection.value,
  (current) => {
    if (current.kind !== 'edge') {
      edgeDialogOpen.value = false
    }
  },
)

watch(selectedEdge, (edge) => {
  if (!edge) {
    edgeDialogOpen.value = false
  }
})

function selectEdgeOnly(edgeId: string): void {
  selection.value = { kind: 'edge', edgeId }
  pendingFromNodeId.value = null
  mode.value = 'select'
  edgeDialogOpen.value = false
}

function selectEdge(edgeId: string): void {
  selectEdgeOnly(edgeId)
  edgeDialogOpen.value = true
}

function handleMapClick(coordinates: Coordinates): void {
  if (mode.value === 'add-node') {
    addManualNode(coordinates)
    return
  }

  if (mode.value === 'select') {
    selection.value = { kind: 'none' }
  }
}

function createNode(
  coordinates: Coordinates,
  name: string,
  region = '',
  country = '',
): TripNode {
  return {
    id: createId(),
    name,
    coordinates: { ...coordinates },
    region,
    country,
    timeZone: null,
    timeZoneSource: 'unknown',
    minimumTransferMinutes: 0,
  }
}

function addManualNode(coordinates: Coordinates): void {
  const name = `Точка ${project.value.nodes.length + 1}`
  const node = createNode(coordinates, name)

  project.value.nodes.push(node)
  void determineNodeTimeZone(node.id)
  selection.value = { kind: 'node', nodeId: node.id }

  void lookupNode(node.id, name)
}

function addSearchResult(result: GeocodingResult): void {
  const node = createNode(
    result.coordinates,
    result.name,
    result.region,
    result.country,
  )

  project.value.nodes.push(node)
  void determineNodeTimeZone(node.id)
  selection.value = { kind: 'node', nodeId: node.id }
  mode.value = 'select'
  pendingFromNodeId.value = null

  searchQuery.value = ''
  searchResults.value = []

  mapRef.value?.flyTo(node.coordinates)
}

async function lookupNode(
  nodeId: string,
  replaceNameIfUnchanged?: string,
): Promise<void> {
  const node = project.value.nodes.find((item) => item.id === nodeId)
  if (!node) return

  const projectId = project.value.id
  const coordinates = { ...node.coordinates }
  const version = (nodeLookupVersions.get(nodeId) ?? 0) + 1

  nodeLookupVersions.set(nodeId, version)

  const controller = new AbortController()
  reverseControllers.add(controller)
  reverseBusyCount.value++

  try {
    const results = await reverseGeocode(coordinates, {
      signal: controller.signal,
    })

    if (
      !alive ||
      project.value.id !== projectId ||
      nodeLookupVersions.get(nodeId) !== version
    ) {
      return
    }

    const current = project.value.nodes.find((item) => item.id === nodeId)

    if (
      !current ||
      current.coordinates.lng !== coordinates.lng ||
      current.coordinates.lat !== coordinates.lat
    ) {
      return
    }

    const result = results[0]

    if (!result) {
      notice.value = 'Адрес не найден. Название точки можно ввести вручную.'
      return
    }

    current.region = result.region
    current.country = result.country

    if (
      replaceNameIfUnchanged !== undefined &&
      current.name === replaceNameIfUnchanged
    ) {
      current.name = result.locality || result.name
    }

    notice.value = `По координатам найдено: ${result.displayName}`
  } catch (error) {
    if (
      alive &&
      !controller.signal.aborted &&
      project.value.id === projectId &&
      nodeLookupVersions.get(nodeId) === version
    ) {
      notice.value = errorMessage(error)
    }
  } finally {
    reverseControllers.delete(controller)

    if (alive) {
      reverseBusyCount.value = Math.max(0, reverseBusyCount.value - 1)
    }
  }
}

function moveNode(nodeId: string, coordinates: Coordinates): void {
  const node = project.value.nodes.find((item) => item.id === nodeId)
  if (!node) return

  nodeLookupVersions.set(
    nodeId,
    (nodeLookupVersions.get(nodeId) ?? 0) + 1,
  )

  node.coordinates = { ...coordinates }

  if (node.timeZoneSource !== 'manual') {
    node.timeZone = null
    node.timeZoneSource = 'unknown'
    void determineNodeTimeZone(nodeId)
  }

  notice.value =
    'Точка перемещена. Таймзоны существующих рейсов не изменены. ' +
    'Ручная таймзона точки, если задана, сохранена.'
}

function updateNodeTimeZone(node: TripNode, event: Event): void {
  const value = (event.target as HTMLInputElement).value.trim()

  node.timeZone = value || null
  node.timeZoneSource = value ? 'manual' : 'unknown'

  notice.value =
    'Таймзона точки изменена. Таймзоны существующих карточек остаются прежними.'
}

function setRouteStart(nodeId: string): void {
  project.value.routeSearch.startNodeId = nodeId
  applyStartTimeZone()
}

function applyStartTimeZone(): void {
  const search = project.value.routeSearch
  const node = project.value.nodes.find(
    (item) => item.id === search.startNodeId,
  )

  if (!node) return

  search.earliestDeparture.timeZone = node.timeZone ?? ''
  search.earliestDeparture.disambiguation = 'reject'

  if (!search.earliestDeparture.localDateTime && node.timeZone) {
    try {
      search.earliestDeparture.localDateTime = localDateTimeAt(
        Date.now(),
        node.timeZone,
      )
    } catch {
      notice.value = 'Проверьте таймзону начальной точки.'
    }
  }
}

function deleteSelectedNode(): void {
  const node = selectedNode.value
  if (!node) return

  const connected = project.value.edges.filter(
    (edge) =>
      edge.fromNodeId === node.id ||
      edge.toNodeId === node.id,
  )

  if (
    !window.confirm(
      `Удалить «${node.name}»? Связанных рёбер: ${connected.length}. Их карточки также будут удалены.`,
    )
  ) {
    return
  }

  project.value.nodes = project.value.nodes.filter(
    (item) => item.id !== node.id,
  )

  project.value.edges = project.value.edges.filter(
    (edge) =>
      edge.fromNodeId !== node.id &&
      edge.toNodeId !== node.id,
  )

  if (project.value.routeSearch.startNodeId === node.id) {
    project.value.routeSearch.startNodeId = null
  }

  if (project.value.routeSearch.endNodeId === node.id) {
    project.value.routeSearch.endNodeId = null
  }

  nodeLookupVersions.delete(node.id)
  pendingFromNodeId.value = null
  selection.value = { kind: 'none' }
}

function deleteSelectedEdge(): void {
  const edge = selectedEdge.value
  if (!edge) return

  if (!window.confirm('Удалить связь вместе со всеми вариантами проезда?')) {
    return
  }

  project.value.edges = project.value.edges.filter(
    (item) => item.id !== edge.id,
  )

  selection.value = { kind: 'none' }
}

function addOption(): void {
  const edge = selectedEdge.value
  if (!edge) return

  const from = project.value.nodes.find(
    (node) => node.id === edge.fromNodeId,
  )

  const to = project.value.nodes.find(
    (node) => node.id === edge.toNodeId,
  )

  edge.options.push({
    id: createId(),
    name: '',
    descriptionMarkdown: '',
    cost: 0,
    departure: {
      localDateTime: '',
      timeZone: from?.timeZone ?? '',
      disambiguation: 'reject',
    },
    arrival: {
      localDateTime: '',
      timeZone: to?.timeZone ?? '',
      disambiguation: 'reject',
    },
    enabled: true,
  })
}

function duplicateOption(option: TravelOption): void {
  selectedEdge.value?.options.push({
    ...option,
    id: createId(),
    name: option.name ? `${option.name} — копия` : '',
    departure: { ...option.departure },
    arrival: { ...option.arrival },
  })
}

function deleteOption(optionId: string): void {
  const edge = selectedEdge.value
  if (!edge) return

  if (!window.confirm('Удалить этот вариант проезда?')) return

  edge.options = edge.options.filter((option) => option.id !== optionId)
}

function optionIssues(option: TravelOption): ValidationIssue[] {
  const edge = selectedEdge.value
  if (!edge) return []

  const result = validateTravelOption(edge, option, project.value.nodes)
  return result.ok ? [] : result.issues
}

function optionDuration(option: TravelOption): string {
  const departure = resolveZonedDateTime(option.departure)
  const arrival = resolveZonedDateTime(option.arrival)

  if (
    !departure.ok ||
    !arrival.ok ||
    arrival.value.epochMilliseconds <= departure.value.epochMilliseconds
  ) {
    return '—'
  }

  return formatDuration(
    (arrival.value.epochMilliseconds -
      departure.value.epochMilliseconds) /
      60_000,
  )
}

function timeHint(
  value: TravelOption['departure'],
): string {
  const result = resolveZonedDateTime(value)

  return result.ok
    ? `UTC${result.value.offset} · ${result.value.instantIso}`
    : result.issues.map((issue) => issue.message).join(' ')
}

function renderMarkdown(value: string): string {
  return DOMPurify.sanitize(markdown.render(value))
}

function calculate(): void {
  routeState.value = {
    result: calculateRoute(project.value),
    stale: false,
  }
}

function cameraChanged(camera: MapCamera): void {
  project.value.camera = camera
}

watch(searchQuery, (query) => {
  if (searchTimer !== undefined) clearTimeout(searchTimer)

  searchController?.abort()
  searchController = null

  const version = ++searchVersion
  searchResults.value = []
  searchError.value = ''
  searchBusy.value = false

  if (query.trim().length < 2) return

  searchTimer = setTimeout(async () => {
    const controller = new AbortController()
    searchController = controller
    searchBusy.value = true

    try {
      const results = await searchPlaces(query, {
        signal: controller.signal,
        bias: project.value.camera.center,
      })

      if (alive && version === searchVersion) {
        searchResults.value = results

        if (results.length === 0) {
          searchError.value = 'Ничего не найдено.'
        }
      }
    } catch (error) {
      if (
        alive &&
        version === searchVersion &&
        !controller.signal.aborted
      ) {
        searchError.value = errorMessage(error)
      }
    } finally {
      if (alive && version === searchVersion) {
        searchBusy.value = false
      }
    }
  }, 450)
})

function stopPendingLookups(): void {
  for (const controller of reverseControllers) controller.abort()
  nodeLookupVersions.clear()
}

function replaceProject(next: TripProject): void {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }

  stopPendingLookups()

  project.value = next
  storageBlocked.value = false
  selection.value = { kind: 'none' }
  pendingFromNodeId.value = null
  mode.value = 'select'
  routeState.value = { result: null, stale: false }
  searchQuery.value = ''
  mapError.value = ''
  notice.value = ''

  mapRef.value?.restoreCamera(next.camera)
  saveNow()
}

function newProject(): void {
  if (
    !window.confirm(
      'Создать новый проект? Текущий локальный проект будет заменён. При необходимости сначала экспортируйте его.',
    )
  ) {
    return
  }

  replaceProject(createEmptyProject())
}

function exportCurrentProject(): void {
  const result = exportProject(project.value)

  if (!result.ok) {
    notice.value = issuesText(result.issues)
  } else {
    notice.value =
      'JSON подготовлен. Учтите: пользовательские URL подложки экспортируются вместе с проектом.'
  }
}

async function importSelectedFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''

  if (!file) return

  const result = await importProjectFile(file)

  if (!alive) return

  if (!result.ok) {
    notice.value = `Импорт отклонён: ${issuesText(result.issues)}`
    return
  }

  if (
    !window.confirm(
      `Заменить текущий проект на «${result.value.name}»?`,
    )
  ) {
    return
  }

  replaceProject(result.value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function beforeUnload(): void {
  saveNow()
}

function autoDetectSelectedNodeTimeZone(): void {
  const node = selectedNode.value
  if (!node) return

  node.timeZoneSource = 'unknown'
  node.timeZone = null

  void determineNodeTimeZone(node.id)
}

async function determineNodeTimeZone(nodeId: string): Promise<void> {
  const node = project.value.nodes.find((item) => item.id === nodeId)

  if (!node || node.timeZoneSource === 'manual') return

  const projectId = project.value.id
  const coordinates = { ...node.coordinates }

  try {
    const zones = await lookupTimeZones(coordinates)

    if (!alive || project.value.id !== projectId) return

    const current = project.value.nodes.find(
      (item) => item.id === nodeId,
    )

    if (
      !current ||
      current.timeZoneSource === 'manual' ||
      current.coordinates.lng !== coordinates.lng ||
      current.coordinates.lat !== coordinates.lat
    ) {
      return
    }

    if (zones.length !== 1) {
      notice.value =
        `Для «${current.name}» найдены разные таймзоны: ` +
        `${zones.join(', ')}. Выберите вручную.`
      return
    }

    const timeZone = zones[0]!

    current.timeZone = timeZone
    current.timeZoneSource = 'automatic'

    // Заполняем только пустые таймзоны карточек.
    // Уже заданное время существующих рейсов не изменяем.
    for (const edge of project.value.edges) {
      for (const option of edge.options) {
        if (
          edge.fromNodeId === nodeId &&
          !option.departure.timeZone.trim()
        ) {
          option.departure.timeZone = timeZone
        }

        if (
          edge.toNodeId === nodeId &&
          !option.arrival.timeZone.trim()
        ) {
          option.arrival.timeZone = timeZone
        }
      }
    }

    if (
      project.value.routeSearch.startNodeId === nodeId &&
      !project.value.routeSearch.earliestDeparture.timeZone.trim()
    ) {
      applyStartTimeZone()
    }
  } catch (error) {
    if (!alive || project.value.id !== projectId) return

    const current = project.value.nodes.find(
      (item) => item.id === nodeId,
    )

    if (
      current &&
      current.timeZoneSource !== 'manual' &&
      current.coordinates.lng === coordinates.lng &&
      current.coordinates.lat === coordinates.lat
    ) {
      notice.value =
        `Таймзону «${current.name}» определите вручную. ` +
        errorMessage(error)
    }
  }
}

window.addEventListener('beforeunload', beforeUnload)

onBeforeUnmount(() => {
  alive = false

  if (searchTimer !== undefined) clearTimeout(searchTimer)

  searchController?.abort()
  stopPendingLookups()
  saveNow()

  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="app-shell">
    <datalist id="time-zone-list">
      <option
        v-for="zone in timeZones"
        :key="zone"
        :value="zone"
      />
    </datalist>

    <header class="app-header">
      <div class="app-brand">Trip Sketch</div>

      <input
        v-model="project.name"
        class="project-name"
        aria-label="Название проекта"
        placeholder="Название проекта"
      />

      <div class="search-box">
        <input
          v-model="searchQuery"
          placeholder="Найти город или место…"
          aria-label="Поиск места"
          autocomplete="off"
        />

        <div
          v-if="searchBusy || searchError || searchResults.length"
          class="search-results"
        >
          <div v-if="searchBusy" class="muted">
            Поиск…
          </div>

          <div v-if="searchError" class="error-text">
            {{ searchError }}
          </div>

          <button
            v-for="result in searchResults"
            :key="result.id"
            type="button"
            class="search-result"
            @click="addSearchResult(result)"
          >
            {{ result.displayName }}
          </button>
        </div>
      </div>

      <div class="toolbar">
        <button
          :class="{ active: mode === 'select' }"
          @click="setMode('select')"
        >
          Выбор
        </button>

        <button
          :class="{ active: mode === 'add-node' }"
          @click="setMode('add-node')"
        >
          + Точка
        </button>

        <button
          :class="{ active: mode === 'add-edge' }"
          @click="setMode('add-edge')"
        >
          + Связь
        </button>
      </div>

      <details class="project-menu">
        <summary>Проект</summary>

        <div class="project-menu-content">
          <button @click="exportCurrentProject">
            Экспорт JSON
          </button>

          <button @click="fileInput?.click()">
            Импорт JSON
          </button>

          <button @click="newProject">
            Новый проект
          </button>
        </div>
      </details>

      <input
        ref="fileInput"
        type="file"
        accept=".json,application/json"
        hidden
        @change="importSelectedFile"
      />
    </header>

    <main class="app-main">
      <section class="map-section">
        <TripMap
          ref="mapRef"
          :nodes="project.nodes"
          :edges="project.edges"
          :camera="project.camera"
          :basemap="project.basemap"
          :mode="mode"
          :selection="selection"
          :highlight="highlight"
          :pending-from-node-id="pendingFromNodeId"
          @map-click="handleMapClick"
          @node-click="selectNode"
          @edge-click="selectEdge"
          @edge-select="selectEdgeOnly"
          @node-move="moveNode"
          @camera-change="cameraChanged"
          @map-error="mapError = $event"
        />
      </section>

      <aside class="sidebar">
        <div v-if="notice" class="notice">
          <span>{{ notice }}</span>
          <button class="small-button" @click="notice = ''">
            ×
          </button>
        </div>

        <details v-if="mapError" class="notice warning">
          <summary>Ошибка карты или подложки</summary>
          <p>{{ mapError }}</p>
          <button @click="mapError = ''">
            Скрыть
          </button>
        </details>

        <div v-if="storageBlocked" class="notice warning">
          Локальные данные не удалось прочитать.
          Автосохранение заблокировано. Для продолжения
          импортируйте исправный JSON или создайте новый проект.
        </div>

        <section class="panel">
          <h2>Маршрут</h2>

          <label>
            Начальная точка
            <select
              v-model="project.routeSearch.startNodeId"
              @change="applyStartTimeZone"
            >
              <option :value="null">
                Выберите точку
              </option>

              <option
                v-for="node in project.nodes"
                :key="node.id"
                :value="node.id"
              >
                {{ node.name }}
              </option>
            </select>
          </label>

          <label>
            Конечная точка
            <select v-model="project.routeSearch.endNodeId">
              <option :value="null">
                Выберите точку
              </option>

              <option
                v-for="node in project.nodes"
                :key="node.id"
                :value="node.id"
              >
                {{ node.name }}
              </option>
            </select>
          </label>

          <label>
            Можно отправляться не раньше
            <input
              v-model="project.routeSearch.earliestDeparture.localDateTime"
              type="datetime-local"
              step="60"
            />
          </label>

          <label>
            Таймзона старта
            <input
              v-model="project.routeSearch.earliestDeparture.timeZone"
              list="time-zone-list"
              placeholder="Например, Europe/Moscow"
            />
          </label>

          <details class="advanced-settings">
            <summary>
              Выбор смещения при переводе часов
            </summary>

            <select
              v-model="project.routeSearch.earliestDeparture.disambiguation"
            >
              <option value="reject">
                Запросить при неоднозначности
              </option>
              <option value="earlier">
                Раннее смещение
              </option>
              <option value="later">
                Позднее смещение
              </option>
            </select>
          </details>

          <label>
            Критерий
            <select v-model="project.routeSearch.optimization">
              <option value="cheapest">
                Самый дешёвый
              </option>
              <option value="earliest-arrival">
                Самое раннее прибытие
              </option>
            </select>
          </label>

          <button class="primary full-width" @click="calculate">
            Рассчитать маршрут
          </button>
        </section>

        <section
          v-if="routeState.result"
          class="panel route-result"
          :class="{ 'is-stale': routeState.stale }"
        >
          <h2>Результат</h2>

          <p v-if="routeState.stale" class="warning-text">
            Данные изменились. Результат устарел — пересчитайте маршрут.
          </p>

          <template
            v-if="routeState.result.status === 'invalid-request'"
          >
            <ul class="error-list">
              <li
                v-for="(issue, index) in routeState.result.issues"
                :key="index"
              >
                {{ issue.message }}
              </li>
            </ul>
          </template>

          <template
            v-else-if="routeState.result.status === 'not-found'"
          >
            <p>{{ routeState.result.message }}</p>
          </template>

          <template v-else>
            <div class="route-summary">
              <div>
                Стоимость:
                {{
                  routeState.result.summary.totalCost.toLocaleString('ru-RU')
                }}
                у.е.
              </div>

              <div>
                От заданного старта:
                {{
                  formatDuration(
                    routeState.result.summary.totalDurationMinutes,
                  )
                }}
              </div>

              <div>
                В движении:
                {{
                  formatDuration(
                    routeState.result.summary.totalTravelMinutes,
                  )
                }}
              </div>

              <div>
                Ожидание:
                {{
                  formatDuration(
                    routeState.result.summary.totalWaitingMinutes,
                  )
                }}
              </div>

              <div>
                Переездов:
                {{ routeState.result.summary.legCount }}
              </div>
            </div>

            <p class="muted">
              Прибытие:
              {{ formatResolvedDateTime(routeState.result.arrival) }}
            </p>

            <p v-if="routeState.result.legs.length === 0">
              Начало и конец совпадают — ехать не требуется.
            </p>

            <article
              v-for="(leg, index) in routeState.result.legs"
              :key="`${leg.optionId}-${index}`"
              class="route-leg"
            >
              <button
                class="link-button"
                @click="selectEdge(leg.edgeId)"
              >
                {{ index + 1 }}.
                {{ nodeName(leg.fromNodeId) }}
                → {{ nodeName(leg.toNodeId) }}
              </button>

              <div>{{ leg.optionName }}</div>

              <div>
                {{ leg.cost.toLocaleString('ru-RU') }} у.е.
              </div>

              <p class="muted">
                Отправление:
                {{ formatResolvedDateTime(leg.departure) }}
                <br />
                Прибытие:
                {{ formatResolvedDateTime(leg.arrival) }}
              </p>

              <div class="muted">
                В пути: {{ formatDuration(leg.travelMinutes) }}.
                Ожидание перед рейсом:
                {{ formatDuration(leg.waitingBeforeMinutes) }}.
              </div>
            </article>
          </template>

          <details
            v-if="routeState.result.status !== 'invalid-request'"
            class="advanced-settings"
          >
            <summary>
              Диагностика вариантов проезда
            </summary>

            <p class="muted">
              Всего:
              {{ routeState.result.diagnostics.totalOptions }}.
              Корректных включённых:
              {{ routeState.result.diagnostics.usableOptions }}.
              Отключённых:
              {{ routeState.result.diagnostics.disabledOptions }}.
              Некорректных:
              {{ routeState.result.diagnostics.invalidOptions }}.
            </p>

            <div
              v-for="item in routeState.result.diagnostics.issues"
              :key="item.optionId"
              class="error-text"
            >
              <button
                class="link-button"
                @click="selectEdge(item.edgeId)"
              >
                Открыть проблемную связь
              </button>

              <div>{{ issuesText(item.issues) }}</div>
            </div>
          </details>
        </section>

        <section v-if="selectedNode" class="panel">
          <h2>Точка</h2>

          <label>
            Название
            <input v-model="selectedNode.name" />
          </label>

          <div class="muted">
            {{ selectedNode.coordinates.lat.toFixed(5) }},
            {{ selectedNode.coordinates.lng.toFixed(5) }}
          </div>

          <p
            v-if="selectedNode.region || selectedNode.country"
            class="muted"
          >
            {{
              [selectedNode.region, selectedNode.country]
                .filter(Boolean)
                .join(', ')
            }}
          </p>

          <label>
            Таймзона
            <input
              :value="selectedNode.timeZone ?? ''"
              list="time-zone-list"
              placeholder="Выберите или введите IANA timezone"
              @change="updateNodeTimeZone(selectedNode, $event)"
            />
          </label>

          <button
            class="full-width"
            @click="autoDetectSelectedNodeTimeZone"
          >
            Определить таймзону автоматически
          </button>

          <p class="muted">
            Источник:
            {{
              selectedNode.timeZoneSource === 'automatic'
                ? 'по координатам'
                : selectedNode.timeZoneSource === 'manual'
                  ? 'задана вручную'
                  : 'не определена'
            }}
          </p>

          <p v-if="!selectedNode.timeZone" class="warning-text">
            Таймзона пока не определена. Дождитесь определения
            или задайте её вручную.
          </p>

          <label>
            Минимальная пересадка, минут
            <input
              v-model.number="selectedNode.minimumTransferMinutes"
              type="number"
              min="0"
              step="1"
            />
          </label>

          <div class="button-row">
            <button @click="setRouteStart(selectedNode.id)">
              Сделать началом
            </button>

            <button
              @click="project.routeSearch.endNodeId = selectedNode.id"
            >
              Сделать концом
            </button>
          </div>

          <button
            class="full-width"
            @click="lookupNode(selectedNode.id, selectedNode.name)"
          >
            Определить место по координатам
          </button>

          <p class="muted">
            Найденное место может быть ближайшим объектом.
            Координаты точки не изменяются.
          </p>

          <button
            class="danger full-width"
            @click="deleteSelectedNode"
          >
            Удалить точку
          </button>
        </section>

        <section v-if="selectedEdge" class="panel">
          <h2>{{ selectedEdgeTitle }}</h2>

          <p class="muted">
            Вариантов проезда: {{ selectedEdge.options.length }}
          </p>

          <button
            class="primary full-width"
            @click="edgeDialogOpen = true"
          >
            Редактировать варианты проезда
          </button>
        </section>

        <section
          v-if="!selectedNode && !selectedEdge"
          class="panel"
        >
          <h2>Как начать</h2>

          <ol class="help-list">
            <li>
              Найдите место поиском или включите «+ Точка».
            </li>
            <li>
              Таймзона определяется автоматически;
              при необходимости измените её вручную.
            </li>
            <li>
              Нажмите «+ Связь», затем исходную
              и конечную точки.
            </li>
            <li>
              Добавьте конкретные рейсы с датами и ценами.
            </li>
            <li>
              Выберите начало, конец и время старта.
            </li>
            <li>
              Рассчитайте маршрут.
            </li>
          </ol>

          <p class="muted">
            Рейсы не повторяются автоматически на следующий день.
            Для другого отправления создайте отдельную карточку.
          </p>
        </section>

        <section class="panel">
          <details>
            <summary>
              Точки — {{ project.nodes.length }},
              связи — {{ project.edges.length }}
            </summary>

            <div class="node-list">
              <button
                v-for="node in project.nodes"
                :key="node.id"
                @click="
                  selection = { kind: 'node', nodeId: node.id };
                  mapRef?.flyTo(node.coordinates)
                "
              >
                {{ node.name }}
              </button>
            </div>
          </details>
        </section>
      </aside>
    </main>

    <Teleport to="body">
      <div
        v-if="edgeDialogOpen && selectedEdge"
        class="modal-backdrop"
        @click.self="closeEdgeDialog"
      >
        <div
          class="edge-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edge-dialog-title"
        >
          <header class="edge-dialog-header">
            <div>
              <h2 id="edge-dialog-title">
                {{ selectedEdgeTitle }}
              </h2>
              <div class="muted">
                Изменения сохраняются автоматически
              </div>
            </div>

            <button
              type="button"
              aria-label="Закрыть редактор связи"
              @click="closeEdgeDialog"
            >
              Закрыть ×
            </button>
          </header>

          <div class="edge-dialog-body">
            <section v-if="selectedEdge" class="panel">
              <h2>{{ selectedEdgeTitle }}</h2>

              <p class="muted">
                Только это направление.
                Обратная связь создаётся отдельно.
              </p>

              <button class="primary full-width" @click="addOption">
                + Вариант проезда
              </button>

              <p
                v-if="selectedEdge.options.length === 0"
                class="muted"
              >
                Пока нет вариантов.
                Пустая связь не участвует в расчёте.
              </p>

              <article
                v-for="option in selectedEdge.options"
                :key="option.id"
                class="option-card"
                :class="{ 'is-disabled': !option.enabled }"
              >
                <div class="option-card-header">
                  <label class="checkbox-label">
                    <input
                      v-model="option.enabled"
                      type="checkbox"
                    />
                    Использовать в расчёте
                  </label>

                  <button
                    class="small-button"
                    title="Дублировать"
                    @click="duplicateOption(option)"
                  >
                    Копия
                  </button>
                </div>

                <label>
                  Название
                  <input
                    v-model="option.name"
                    placeholder="Например, электричка 07:40"
                  />
                </label>

                <label>
                  Стоимость, у.е.
                  <input
                    v-model.number="option.cost"
                    type="number"
                    min="0"
                    step="any"
                  />
                </label>

                <fieldset
                  v-for="field in timeFields"
                  :key="field"
                  class="time-fieldset"
                >
                  <legend>
                    {{
                      field === 'departure'
                        ? 'Отправление'
                        : 'Прибытие'
                    }}
                  </legend>

                  <label>
                    Дата и местное время
                    <input
                      v-model="option[field].localDateTime"
                      type="datetime-local"
                      step="60"
                    />
                  </label>

                  <label>
                    Таймзона
                    <input
                      v-model="option[field].timeZone"
                      list="time-zone-list"
                      placeholder="Например, Asia/Yekaterinburg"
                    />
                  </label>

                  <details class="advanced-settings">
                    <summary>
                      Смещение при переводе часов
                    </summary>

                    <select v-model="option[field].disambiguation">
                      <option value="reject">
                        Запросить при неоднозначности
                      </option>
                      <option value="earlier">
                        Раннее смещение
                      </option>
                      <option value="later">
                        Позднее смещение
                      </option>
                    </select>
                  </details>

                  <div class="muted time-hint">
                    {{ timeHint(option[field]) }}
                  </div>
                </fieldset>

                <div class="muted">
                  Продолжительность:
                  {{ optionDuration(option) }}
                </div>

                <label>
                  Заметки и ссылки — Markdown
                  <textarea
                    v-model="option.descriptionMarkdown"
                    rows="5"
                    placeholder="[Билеты](https://...)"
                  />
                </label>

                <details
                  v-if="option.descriptionMarkdown"
                  class="advanced-settings"
                >
                  <summary>
                    Предпросмотр заметок
                  </summary>

                  <div
                    class="markdown-content"
                    v-html="renderMarkdown(option.descriptionMarkdown)"
                  />
                </details>

                <ul
                  v-if="optionIssues(option).length"
                  class="error-list"
                >
                  <li
                    v-for="(issue, index) in optionIssues(option)"
                    :key="index"
                  >
                    {{ issue.message }}
                  </li>
                </ul>

                <button
                  class="danger full-width"
                  @click="deleteOption(option.id)"
                >
                  Удалить вариант
                </button>
              </article>

              <button
                class="danger full-width"
                @click="deleteSelectedEdge"
              >
                Удалить связь целиком
              </button>
            </section>

          </div>
        </div>
      </div>
    </Teleport>

    <footer class="app-footer">
      <span>{{ storageMessage }}</span>

      <span v-if="reverseBusyCount > 0">
        Определение места…
      </span>

      <span>
        {{ project.nodes.length }} точек ·
        {{ project.edges.length }} связей
      </span>
    </footer>
  </div>
</template>