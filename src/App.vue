<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import TripMap from './components/TripMap.vue'
import RouteResults from './components/RouteResults.vue'
import EdgeDialog from './components/EdgeDialog.vue'
import NodeDialog from './components/NodeDialog.vue'
import RouteSearchPanel from './components/RouteSearchPanel.vue'
import EdgeSummary from './components/EdgeSummary.vue'
import ProjectToolbar from './components/ProjectToolbar.vue'
import HistoryPanel from './components/HistoryPanel.vue'

import { useRouting } from './composables/useRouting'
import { useProject } from './composables/useProject'
import { useGeocoding } from './composables/useGeocoding'
import { useRouteSearchParams } from './composables/useRouteSearchParams'
import { useTravelOptions } from './composables/useTravelOptions'
import { useProjectFile } from './composables/useProjectFile'
import { useHistory } from './composables/useHistory'

import { createId } from './storage'
import { createDefaultLayover } from './layover'
import { getSuggestedTimeZones } from './services'

import type {
  Coordinates,
  EditorMode,
  GeocodingResult,
  MapCamera,
  MapSelection,
  TripNode,
  TripProject,
} from './types'

const {
  project,
  storageBlocked,
  storageMessage,
  replaceStoredProject,
} = useProject()

const {
  routeState,
  selectedRouteIndex,
  highlight,
  calculate,
  resetRoutes,
} = useRouting(project)

const mode = ref<EditorMode>('select')
const selection = ref<MapSelection>({ kind: 'none' })
const pendingFromNodeId = ref<string | null>(null)

const mapRef = ref<InstanceType<typeof TripMap> | null>(null)

const notice = ref('')
const mapError = ref('')

function notify(message: string): void {
  notice.value = message
}

const NOTICE_TIMEOUT_MS = 8000
let noticeTimer: ReturnType<typeof setTimeout> | undefined

watch(notice, (message) => {
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
  noticeTimer = undefined

  if (message) {
    noticeTimer = setTimeout(() => {
      notice.value = ''
    }, NOTICE_TIMEOUT_MS)
  }
})

function confirmAction(message: string): boolean {
  return window.confirm(message)
}

const {
  setRouteStart,
  setRouteEnd,
  applyStartTimeZone,
  handleNodeTimeZoneDetected,
} = useRouteSearchParams({ project, notify })

const {
  searchQuery,
  searchResults,
  searchBusy,
  searchError,
  reverseBusyCount,
  clearSearch,
  lookupNodePlace,
  determineNodeTimeZone,
  invalidateNode,
  resetForNewProject,
} = useGeocoding({
  project,
  notify,
  onNodeTimeZoneDetected: handleNodeTimeZoneDetected,
})

const sidebarTab = ref<'route' | 'history'>('route')

const {
  entries: historyEntries,
  currentIndex: historyIndex,
  canUndo,
  canRedo,
  undo,
  redo,
  jumpTo: jumpToHistory,
  reset: resetHistory,
  beginGroup: beginHistoryGroup,
  endGroup: endHistoryGroup,
} = useHistory({
  project,
  onRestore: (entry) => {
    pendingFromNodeId.value = null
    notify(`Состояние: ${entry.label}`)
  },
})

const edgeDialogOpen = ref(false)
const nodeDialogOpen = ref(false)

// Всё, что изменено за одно открытие диалога, попадает в один пункт истории.
watch(
  () => nodeDialogOpen.value || edgeDialogOpen.value,
  (open) => {
    if (!open) {
      endHistoryGroup()
      return
    }

    beginHistoryGroup(() => {
      const node = selectedNode.value

      if (nodeDialogOpen.value && node) {
        return `Изменена точка «${node.name}»`
      }

      const edge = selectedEdge.value
      const name = (id: string): string =>
        project.value.nodes.find((item) => item.id === id)?.name ?? '?'

      return edge
        ? `Изменена связь ${name(edge.fromNodeId)} → ${name(edge.toNodeId)}`
        : 'Изменения в диалоге'
    })
  },
  { flush: 'post' },
)

const timeZones = getSuggestedTimeZones()

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

const {
  addOption,
  duplicateOption,
  updateTravelOption,
  deleteOption,
} = useTravelOptions({
  project,
  selectedEdge,
  confirm: confirmAction,
})

const {
  newProject,
  exportCurrentProject,
  importSelectedFile,
} = useProjectFile({
  project,
  notify,
  confirm: confirmAction,
  replaceProject,
})

const modeHint = computed(() => {
  if (mode.value === 'add-node') {
    return 'Щёлкните по карте, чтобы поставить точку.'
  }

  if (mode.value === 'add-edge') {
    return pendingFromNodeId.value === null
      ? 'Выберите начальную точку связи.'
      : 'Теперь выберите конечную точку связи.'
  }

  return ''
})

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || mode.value === 'select') return
  if (nodeDialogOpen.value || edgeDialogOpen.value) return

  setMode('select')
}

onMounted(() => window.addEventListener('keydown', handleEscape))

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape)
  if (noticeTimer !== undefined) clearTimeout(noticeTimer)
})

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
    layover: createDefaultLayover(),
  }
}

function addManualNode(coordinates: Coordinates): void {
  const name = `Точка ${project.value.nodes.length + 1}`
  const node = createNode(coordinates, name)

  project.value.nodes.push(node)
  void determineNodeTimeZone(node.id)
  selection.value = { kind: 'node', nodeId: node.id }

  void lookupNodePlace(node.id, name)
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

  clearSearch()

  mapRef.value?.flyTo(node.coordinates)
}

function moveNode(nodeId: string, coordinates: Coordinates): void {
  const node = project.value.nodes.find((item) => item.id === nodeId)
  if (!node) return

  invalidateNode(nodeId)

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

  invalidateNode(node.id)
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

  void lookupNodePlace(node.id, node.name)
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

function cameraChanged(camera: MapCamera): void {
  project.value.camera = camera
}

function replaceProject(next: TripProject): void {
  resetForNewProject()

  replaceStoredProject(next)
  resetHistory()

  selection.value = { kind: 'none' }
  pendingFromNodeId.value = null
  mode.value = 'select'

  resetRoutes()

  mapError.value = ''
  notice.value = ''

  nodeDialogOpen.value = false
  edgeDialogOpen.value = false

  mapRef.value?.restoreCamera(next.camera)
}

function autoDetectSelectedNodeTimeZone(): void {
  const node = selectedNode.value
  if (!node) return

  node.timeZoneSource = 'unknown'
  node.timeZone = null

  void determineNodeTimeZone(node.id)
}

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

        <div v-if="modeHint" class="mode-hint" role="status">
          <span>{{ modeHint }}</span>
          <button type="button" class="small-button" @click="setMode('select')">
            Отмена (Esc)
          </button>
        </div>

        <div v-if="notice" class="toast" role="status" aria-live="polite">
          <span>{{ notice }}</span>
          <button
            type="button"
            class="small-button"
            aria-label="Закрыть уведомление"
            @click="notice = ''"
          >
            ×
          </button>
        </div>
      </section>

      <aside class="sidebar">
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

        <div class="sidebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="sidebarTab === 'route'"
            :class="{ active: sidebarTab === 'route' }"
            @click="sidebarTab = 'route'"
          >
            Маршрут
          </button>

          <button
            type="button"
            role="tab"
            :aria-selected="sidebarTab === 'history'"
            :class="{ active: sidebarTab === 'history' }"
            @click="sidebarTab = 'history'"
          >
            История
            <span class="muted">{{ historyEntries.length - 1 }}</span>
          </button>
        </div>

        <HistoryPanel
          v-if="sidebarTab === 'history'"
          :entries="historyEntries"
          :current-index="historyIndex"
          :can-undo="canUndo"
          :can-redo="canRedo"
          @undo="undo"
          @redo="redo"
          @jump="jumpToHistory"
        />

        <template v-else>
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
        </template>
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