<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import TripMap from './components/TripMap.vue'
import RouteResults from './components/RouteResults.vue'
import EdgeDialog from './components/EdgeDialog.vue'
import NodeDialog from './components/NodeDialog.vue'
import RouteSearchPanel from './components/RouteSearchPanel.vue'
import EdgeSummary from './components/EdgeSummary.vue'
import ProjectToolbar from './components/ProjectToolbar.vue'

import {
  createEmptyProject,
  createId,
  exportProject,
  importProjectFile,
  loadProject,
  saveProject,
} from './storage'

import {
  getSuggestedTimeZones,
  localDateTimeAt,
  reverseGeocode,
  searchPlaces,
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

const selectedRouteIndex = ref(0)

const selectedRoute = computed(() => {
  const result = routeState.value.result

  if (result?.status !== 'found') return null

  return (
    result.routes[selectedRouteIndex.value] ??
    result.routes[0] ??
    null
  )
})

watch(
  () => routeState.value.result,
  () => {
    selectedRouteIndex.value = 0
  },
  { flush: 'sync' },
)

const mapRef = ref<InstanceType<typeof TripMap> | null>(null)

const notice = ref('')
const mapError = ref('')

const searchQuery = ref('')
const searchResults = ref<GeocodingResult[]>([])
const searchBusy = ref(false)
const searchError = ref('')
const reverseBusyCount = ref(0)
const edgeDialogOpen = ref(false)
const nodeDialogOpen = ref(false)

const timeZones = getSuggestedTimeZones()

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
  const route = selectedRoute.value

  if (routeState.value.stale || !route) return null

  return {
    edgeIds: [
      ...new Set(route.legs.map((leg) => leg.edgeId)),
    ],
    nodeIds: [
      ...new Set([
        route.startNodeId,
        ...route.legs.map((leg) => leg.toNodeId),
      ]),
    ],
  }
})

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

function openNodeDialog(nodeId: string): void {
  if (!project.value.nodes.some((node) => node.id === nodeId)) {
    return
  }

  edgeDialogOpen.value = false
  pendingFromNodeId.value = null
  mode.value = 'select'
  selection.value = { kind: 'node', nodeId }
  nodeDialogOpen.value = true
}

function selectNode(nodeId: string): void {
  if (mode.value !== 'add-edge') {
    openNodeDialog(nodeId)
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

watch(
  () => selection.value,
  (current) => {
    if (current.kind !== 'node') {
      nodeDialogOpen.value = false
    }
  },
)

watch(selectedNode, (node) => {
  if (!node) {
    nodeDialogOpen.value = false
  }
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
  nodeDialogOpen.value = false
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

function updateNodeTimeZone(timeZone: string): void {
  const node = selectedNode.value
  if (!node) return

  const value = timeZone.trim()

  node.timeZone = value || null
  node.timeZoneSource = value ? 'manual' : 'unknown'

  notice.value =
    'Таймзона точки изменена. ' +
    'Таймзоны существующих карточек остаются прежними.'
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

function updateSelectedNode(next: TripNode): void {
  const current = selectedNode.value

  if (!current || current.id !== next.id) return

  const index = project.value.nodes.findIndex(
    (node) => node.id === next.id,
  )

  if (index === -1) return

  project.value.nodes.splice(index, 1, next)
}

function lookupSelectedNodePlace(): void {
  const node = selectedNode.value
  if (!node) return

  void lookupNode(node.id, node.name)
}

function setRouteEnd(nodeId: string): void {
  project.value.routeSearch.endNodeId = nodeId
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

function updateTravelOption(option: TravelOption): void {
  const edge = selectedEdge.value
  if (!edge) return

  const index = edge.options.findIndex(
    (item) => item.id === option.id,
  )

  if (index === -1) return

  edge.options.splice(index, 1, option)
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

  nodeDialogOpen.value = false
  edgeDialogOpen.value = false

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

async function importSelectedFile(file: File): Promise<void> {
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

    <ProjectToolbar
      v-model:project-name="project.name"
      v-model:search-query="searchQuery"
      :search-results="searchResults"
      :search-busy="searchBusy"
      :search-error="searchError"
      :mode="mode"
      @set-mode="setMode"
      @select-place="addSearchResult"
      @export-project="exportCurrentProject"
      @import-project="importSelectedFile"
      @new-project="newProject"
    />

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

        <RouteSearchPanel
          v-model:parameters="project.routeSearch"
          :nodes="project.nodes"
          @start-change="applyStartTimeZone"
          @calculate="calculate"
        />

        <RouteResults
          v-model:selected-index="selectedRouteIndex"
          :result="routeState.result"
          :stale="routeState.stale"
          :nodes="project.nodes"
          @open-edge="selectEdge"
          @recalculate="calculate"
        />

        <section v-if="selectedNode" class="panel">
          <h2>{{ selectedNode.name }}</h2>

          <p class="muted">
            {{ selectedNode.timeZone || 'Таймзона не определена' }}
          </p>

          <button
            type="button"
            class="primary full-width"
            @click="openNodeDialog(selectedNode.id)"
          >
            Редактировать точку
          </button>
        </section>

        <EdgeSummary
          v-if="selectedEdge"
          :edge="selectedEdge"
          :nodes="project.nodes"
          @edit="selectEdge"
        />

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

    <NodeDialog
      v-model:open="nodeDialogOpen"
      :node="selectedNode"
      :storage-blocked="storageBlocked"
      @update-node="updateSelectedNode"
      @set-time-zone="updateNodeTimeZone"
      @detect-time-zone="autoDetectSelectedNodeTimeZone"
      @lookup-place="lookupSelectedNodePlace"
      @set-start="setRouteStart"
      @set-end="setRouteEnd"
      @delete-node="deleteSelectedNode"
    />

    <EdgeDialog
      v-model:open="edgeDialogOpen"
      :edge="selectedEdge"
      :nodes="project.nodes"
      :storage-blocked="storageBlocked"
      @add-option="addOption"
      @update-option="updateTravelOption"
      @duplicate-option="duplicateOption"
      @delete-option="deleteOption"
      @delete-edge="deleteSelectedEdge"
    />

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