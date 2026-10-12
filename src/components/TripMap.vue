<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  LngLatBounds,
} from 'maplibre-gl'
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl'
import type {
  FeatureCollection,
  LineString,
  MultiLineString,
} from 'geojson'

import { greatCircle } from '@turf/great-circle'
import { midpoint } from '@turf/midpoint'

import type {
  BasemapSettings,
  Coordinates,
  EditorMode,
  MapCamera,
  MapHighlight,
  MapSelection,
  TripNode,
  TripEdge,
} from '../types'

const props = defineProps<{
  nodes: TripNode[]
  edges: TripEdge[]
  camera: MapCamera
  basemap: BasemapSettings
  mode: EditorMode
  selection: MapSelection
  highlight: MapHighlight | null
  pendingFromNodeId: string | null
}>()

const emit = defineEmits<{
  'map-click': [coordinates: Coordinates]
  'node-click': [nodeId: string]
  'edge-click': [edgeId: string]
  'edge-select': [edgeId: string]
  'node-move': [nodeId: string, coordinates: Coordinates]
  'camera-change': [camera: MapCamera]
  'map-error': [message: string]
}>()

const container = ref<HTMLDivElement | null>(null)

let map: MapLibreMap | null = null
let ready = false
let disposed = false
let lastError = ''

const nodeMarkers = new Map<string, Marker>()
const arrowMarkers = new Map<string, Marker>()

const SOURCE_ID = 'trip-edges'
const LINE_LAYER_ID = 'trip-edges-line'
const HIT_LAYER_ID = 'trip-edges-hit'

interface EdgeGeometry {
  geometry: LineString | MultiLineString
  midpoint: [number, number]
  tangentFrom: [number, number]
  tangentTo: [number, number]
}

function createStyle(basemap: BasemapSettings): StyleSpecification {
  const raster =
    basemap.kind === 'raster'
      ? basemap
      : {
          tileUrls: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
          tileSize: 256 as const,
          minZoom: 0,
          maxZoom: 19,
        }

  return {
    version: 8,
    sources: {
      basemap: {
        type: 'raster',
        tiles: raster.tileUrls,
        tileSize: raster.tileSize,
        attribution: raster.attribution,
        minzoom: raster.minZoom,
        maxzoom: raster.maxZoom,
      },
    },
    layers: [
      {
        id: 'basemap',
        type: 'raster',
        source: 'basemap',
      },
    ],
  }
}

function edgeGeometry(
  from: Coordinates,
  to: Coordinates,
): EdgeGeometry {
  const start: [number, number] = [from.lng, from.lat]
  const end: [number, number] = [to.lng, to.lat]

  const arc = greatCircle(start, end, {
    npoints: 129,
  })

  const center = midpoint(start, end).geometry.coordinates
  const centerCoordinates: [number, number] = [center[0]!, center[1]!]

  const firstHalf = greatCircle(start, centerCoordinates, {
    npoints: 33,
  })

  const secondHalf = greatCircle(centerCoordinates, end, {
    npoints: 33,
  })

  function flatten(
    geometry: LineString | MultiLineString,
  ): [number, number][] {
    const positions =
      geometry.type === 'LineString'
        ? geometry.coordinates
        : geometry.coordinates.flat()

    return positions.map((position) => [position[0]!, position[1]!])
  }

  const before = flatten(firstHalf.geometry)
  const after = flatten(secondHalf.geometry)

  return {
    geometry: arc.geometry,
    midpoint: centerCoordinates,
    tangentFrom:
      before[Math.max(0, before.length - 2)] ?? start,
    tangentTo:
      after[Math.min(1, after.length - 1)] ?? end,
  }
}

function selectedNode(nodeId: string): boolean {
  return (
    props.selection.kind === 'node' &&
    props.selection.nodeId === nodeId
  )
}

function selectedEdge(edgeId: string): boolean {
  return (
    props.selection.kind === 'edge' &&
    props.selection.edgeId === edgeId
  )
}

function edgeColor(edgeId: string): string {
  if (selectedEdge(edgeId)) return '#f59e0b'
  if (props.highlight?.edgeIds.includes(edgeId)) return '#22c55e'

  const edge = props.edges.find((item) => item.id === edgeId)

  return edge && edge.options.length > 0
    ? '#60a5fa'
    : '#94a3b8'
}

function edgeOpacity(edgeId: string): number {
  return props.highlight &&
    !props.highlight.edgeIds.includes(edgeId) &&
    !selectedEdge(edgeId)
    ? 0.3
    : 0.95
}

function buildFeatures(): FeatureCollection<LineString | MultiLineString> {
  const nodes = new Map(props.nodes.map((node) => [node.id, node]))
  const features: FeatureCollection<
    LineString | MultiLineString
  >['features'] = []

  for (const edge of props.edges) {
    const from = nodes.get(edge.fromNodeId)
    const to = nodes.get(edge.toNodeId)

    if (!from || !to) continue

    const arc = edgeGeometry(from.coordinates, to.coordinates)

    features.push({
      type: 'Feature',
      properties: {
        edgeId: edge.id,
        color: edgeColor(edge.id),
        opacity: edgeOpacity(edge.id),
        width: selectedEdge(edge.id) ? 5 : 3,
      },
      geometry: arc.geometry,
    })
  }

  return {
    type: 'FeatureCollection',
    features,
  }
}

function installGraphLayers(instance: MapLibreMap): void {
  if (!instance.getSource(SOURCE_ID)) {
    instance.addSource(SOURCE_ID, {
      type: 'geojson',
      data: buildFeatures(),
    })
  }

  if (!instance.getLayer(LINE_LAYER_ID)) {
    instance.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: {
        visibility: 'visible',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['get', 'width'],
        'line-opacity': ['get', 'opacity'],
        },
    })
  }

  if (!instance.getLayer(HIT_LAYER_ID)) {
    instance.addLayer({
      id: HIT_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-width': 20,
        'line-opacity': 0,
      },
    })
  }

  instance.moveLayer(LINE_LAYER_ID)
  instance.moveLayer(HIT_LAYER_ID)
}

function createNodeMarker(
  instance: MapLibreMap,
  node: TripNode,
): Marker {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'trip-node-marker'

  const dot = document.createElement('span')
  dot.className = 'trip-node-dot'

  const label = document.createElement('span')
  label.className = 'trip-node-label'

  element.append(dot, label)

  element.addEventListener('click', (event) => {
    event.stopPropagation()
    emit('node-click', node.id)
  })

  element.addEventListener('dblclick', (event) => {
    event.stopPropagation()
  })

  const marker = new Marker({
    element,
    anchor: 'center',
    draggable: props.mode === 'select',
  })
    .setLngLat([node.coordinates.lng, node.coordinates.lat])
    .addTo(instance)

  marker.on('dragend', () => {
    const position = marker.getLngLat()

    emit('node-move', node.id, {
      lng: position.wrap().lng,
      lat: position.lat,
    })
  })

  return marker
}

function updateNodes(instance: MapLibreMap): void {
  const activeIds = new Set(props.nodes.map((node) => node.id))

  for (const [id, marker] of nodeMarkers) {
    if (!activeIds.has(id)) {
      marker.remove()
      nodeMarkers.delete(id)
    }
  }

  for (const node of props.nodes) {
    const marker =
      nodeMarkers.get(node.id) ?? createNodeMarker(instance, node)

    nodeMarkers.set(node.id, marker)

    marker.setLngLat([node.coordinates.lng, node.coordinates.lat])
    marker.setDraggable(props.mode === 'select')

    const element = marker.getElement()
    const label = element.querySelector('.trip-node-label')

    if (label) label.textContent = node.name

    element.setAttribute('aria-label', `Точка: ${node.name}`)
    element.title = node.name

    element.classList.toggle('is-selected', selectedNode(node.id))
    element.classList.toggle(
      'is-pending',
      props.pendingFromNodeId === node.id,
    )
    element.classList.toggle(
      'is-highlighted',
      props.highlight?.nodeIds.includes(node.id) ?? false,
    )
    element.classList.toggle(
      'is-muted',
      props.highlight !== null &&
        !props.highlight.nodeIds.includes(node.id) &&
        !selectedNode(node.id),
    )
  }
}

function createArrowMarker(
  instance: MapLibreMap,
  edgeId: string,
  position: [number, number],
): Marker {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = 'trip-edge-arrow'
  element.textContent = '➤'

  element.addEventListener('click', (event) => {
    event.stopPropagation()
    emit('edge-click', edgeId)
  })

  element.addEventListener('dblclick', (event) => {
    event.stopPropagation()
  })

  return new Marker({
    element,
    anchor: 'center',
    rotationAlignment: 'viewport',
    pitchAlignment: 'viewport',
  })
    .setLngLat(position)
    .addTo(instance)
}

function updateArrows(instance: MapLibreMap): void {
  const activeIds = new Set(props.edges.map((edge) => edge.id))

  for (const [id, marker] of arrowMarkers) {
    if (!activeIds.has(id)) {
      marker.remove()
      arrowMarkers.delete(id)
    }
  }

  const nodes = new Map(props.nodes.map((node) => [node.id, node]))

  for (const edge of props.edges) {
    const from = nodes.get(edge.fromNodeId)
    const to = nodes.get(edge.toNodeId)

    if (!from || !to) {
      arrowMarkers.get(edge.id)?.remove()
      arrowMarkers.delete(edge.id)
      continue
    }

    const arc = edgeGeometry(from.coordinates, to.coordinates)

    const marker =
      arrowMarkers.get(edge.id) ??
      createArrowMarker(instance, edge.id, arc.midpoint)

    arrowMarkers.set(edge.id, marker)
    marker.setLngLat(arc.midpoint)

    const element = marker.getElement()

    element.style.color = edgeColor(edge.id)
    element.style.opacity = String(edgeOpacity(edge.id))
    element.title = `${from.name} → ${to.name}`

    element.setAttribute(
      'aria-label',
      `Редактировать связь: ${from.name} → ${to.name}`,
    )
  }

  rotateArrows()
}

function rotateArrows(): void {
  const instance = map
  if (!instance || !ready) return

  const nodes = new Map(props.nodes.map((node) => [node.id, node]))

  for (const edge of props.edges) {
    const marker = arrowMarkers.get(edge.id)
    const from = nodes.get(edge.fromNodeId)
    const to = nodes.get(edge.toNodeId)

    if (!marker || !from || !to) continue

    const arc = edgeGeometry(from.coordinates, to.coordinates)
    const markerLongitude = marker.getLngLat().lng

    function nearestLongitude(longitude: number): number {
      return (
        longitude +
        360 * Math.round((markerLongitude - longitude) / 360)
      )
    }

    const before = instance.project({
      lng: nearestLongitude(arc.tangentFrom[0]),
      lat: arc.tangentFrom[1],
    })

    const after = instance.project({
      lng: nearestLongitude(arc.tangentTo[0]),
      lat: arc.tangentTo[1],
    })

    const angle =
      Math.atan2(after.y - before.y, after.x - before.x) *
      (180 / Math.PI)

    marker.setRotation(angle)
  }
}

function updateCursor(): void {
  if (!map) return

  map.getCanvas().style.cursor =
    props.mode === 'add-node'
      ? 'crosshair'
      : props.mode === 'add-edge'
        ? 'pointer'
        : ''
}

function refresh(): void {
  const instance = map
  if (!instance || !ready) return

  try {
    installGraphLayers(instance)

    const data = buildFeatures()
    const source = instance.getSource(SOURCE_ID) as
      | GeoJSONSource
      | undefined

    source?.setData(data)

    console.log('[TripMap] Линии', {
      sourceExists: Boolean(source),
      layerExists: Boolean(instance.getLayer(LINE_LAYER_ID)),
      featureCount: data.features.length,
      geojson: JSON.stringify(data),
      layer: instance.getLayer(LINE_LAYER_ID),
    })

    updateNodes(instance)
    updateArrows(instance)
    updateCursor()
  } catch (error) {
    console.error('[TripMap] Ошибка обновления', error)

    emit(
      'map-error',
      error instanceof Error ? error.message : String(error),
    )
  }
}

function publishCamera(): void {
  const instance = map
  if (!instance || !ready) return

  const center = instance.getCenter()

  emit('camera-change', {
    center: {
      lng: center.wrap().lng,
      lat: center.lat,
    },
    zoom: instance.getZoom(),
    bearing: instance.getBearing(),
    pitch: instance.getPitch(),
  })
}

function flyTo(coordinates: Coordinates, zoom?: number): void {
  const instance = map
  if (!instance) return

  instance.flyTo({
    center: [coordinates.lng, coordinates.lat],
    zoom: zoom ?? Math.max(instance.getZoom(), 10),
    duration: 700,
  })
}

function fitProject(): void {
  const instance = map
  if (!instance || props.nodes.length === 0) return

  if (props.nodes.length === 1) {
    flyTo(props.nodes[0]!.coordinates, 10)
    return
  }

  const bounds = new LngLatBounds()

  for (const node of props.nodes) {
    bounds.extend([node.coordinates.lng, node.coordinates.lat])
  }

  instance.fitBounds(bounds, {
    padding: 70,
    maxZoom: 12,
    duration: 700,
  })
}

function restoreCamera(camera: MapCamera): void {
  map?.jumpTo({
    center: [camera.center.lng, camera.center.lat],
    zoom: camera.zoom,
    bearing: camera.bearing,
    pitch: camera.pitch,
  })
}

defineExpose({ flyTo, fitProject, restoreCamera })

watch(
  () => [
    props.nodes,
    props.edges,
    props.selection,
    props.highlight,
    props.pendingFromNodeId,
    props.mode,
  ],
  refresh,
  { deep: true },
)

watch(
  () => props.basemap,
  (basemap) => {
    if (!map) return

    ready = false
    map.setStyle(createStyle(basemap))
  },
  { deep: true },
)

onMounted(() => {
  const element = container.value
  if (!element) return

  try {
    const instance = new MapLibreMap({
      container: element,
      style: createStyle(props.basemap),
      center: [props.camera.center.lng, props.camera.center.lat],
      zoom: props.camera.zoom,
      bearing: props.camera.bearing,
      pitch: props.camera.pitch,
      maxPitch: 85,
      attributionControl: {},
    })

    map = instance

    instance.addControl(new NavigationControl(), 'top-left')
    instance.addControl(new ScaleControl(), 'bottom-left')

    instance.on('style.load', () => {
      if (disposed) return

      installGraphLayers(instance)
      ready = true
      refresh()
    })

    instance.on('click', (event) => {
      if (!ready) return

      if (props.mode !== 'add-node') {
        const features = instance.queryRenderedFeatures(event.point, {
          layers: [HIT_LAYER_ID],
        })

        const edgeId = features[0]?.properties?.edgeId

        if (typeof edgeId === 'string') {
          emit('edge-select', edgeId)
          return
        }
      }

      emit('map-click', {
        lng: event.lngLat.wrap().lng,
        lat: event.lngLat.lat,
      })
    })

    instance.on('mousemove', (event) => {
      if (!ready) return

      if (props.mode !== 'select') {
        updateCursor()
        return
      }

      const features = instance.queryRenderedFeatures(event.point, {
        layers: [HIT_LAYER_ID],
      })

      instance.getCanvas().style.cursor =
        features.length > 0 ? 'pointer' : ''
    })

    instance.on('move', rotateArrows)
    instance.on('moveend', publishCamera)

    instance.on('error', (event) => {
      console.error('[TripMap] MapLibre error', event.error)
      const message = event.error?.message ?? 'Ошибка загрузки карты.'

      if (message !== lastError) {
        lastError = message
        emit('map-error', message)
      }
    })
  } catch (error) {
    emit(
      'map-error',
      error instanceof Error
        ? error.message
        : 'Не удалось запустить карту.',
    )
  }
})

onBeforeUnmount(() => {
  disposed = true
  ready = false

  for (const marker of nodeMarkers.values()) marker.remove()
  for (const marker of arrowMarkers.values()) marker.remove()

  nodeMarkers.clear()
  arrowMarkers.clear()

  map?.remove()
  map = null
})
</script>

<template>
  <div class="trip-map">
    <div ref="container" class="trip-map-canvas" />

    <div class="trip-map-hint">
      <template v-if="mode === 'add-node'">
        Кликните по карте, чтобы добавить точку
      </template>

      <template v-else-if="mode === 'add-edge'">
        {{
          pendingFromNodeId
            ? 'Выберите конечную точку'
            : 'Выберите исходную точку'
        }}
      </template>

      <template v-else>
        Клик — редактирование · Точки можно перетаскивать
      </template>
    </div>

    <button
      type="button"
      class="trip-map-fit"
      :disabled="nodes.length === 0"
      @click="fitProject"
    >
      Показать все точки
    </button>
  </div>
</template>

<style scoped>
.trip-map {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 300px;
}

.trip-map-canvas {
  position: absolute;
  inset: 0;
}

.trip-map-hint {
  position: absolute;
  z-index: 2;
  top: 12px;
  left: 58px;
  right: 12px;
  width: fit-content;
  max-width: calc(100% - 80px);
  padding: 8px 12px;
  border: 1px solid #334155;
  border-radius: 8px;
  background: rgb(15 23 42 / 92%);
  color: #e2e8f0;
  font-size: 12px;
  pointer-events: none;
}

.trip-map-fit {
  position: absolute;
  z-index: 2;
  bottom: 38px;
  left: 12px;
  padding: 8px 12px;
  border: 1px solid #334155;
  border-radius: 8px;
  background: #0f172a;
  color: #e2e8f0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.trip-map-fit:disabled {
  opacity: 0.5;
  cursor: default;
}

:deep(.trip-node-marker) {
  position: absolute;
  top: 0;
  left: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

:deep(.trip-node-dot) {
  display: block;
  width: 16px;
  height: 16px;
  border: 3px solid #ffffff;
  border-radius: 50%;
  background: #2563eb;
  box-shadow: 0 1px 6px rgb(0 0 0 / 55%);
}

:deep(.trip-node-label) {
  position: absolute;
  left: 27px;
  top: 0;
  max-width: 200px;
  overflow: hidden;
  padding: 3px 7px;
  border-radius: 5px;
  background: rgb(15 23 42 / 90%);
  color: #f8fafc;
  font-family: system-ui, sans-serif;
  font-size: 12px;
  line-height: 18px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:deep(.trip-node-marker.is-selected .trip-node-dot) {
  background: #f59e0b;
}

:deep(.trip-node-marker.is-highlighted:not(.is-selected) .trip-node-dot) {
  background: #22c55e;
}

:deep(.trip-node-marker.is-pending .trip-node-dot) {
  background: #f97316;
  box-shadow: 0 0 0 6px rgb(249 115 22 / 30%);
}

:deep(.trip-node-marker.is-muted) {
  opacity: 0.45;
}

:deep(.trip-edge-arrow) {
  position: absolute;
  top: 0;
  left: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid #334155;
  border-radius: 50%;
  background: #0f172a;
  font-family: Arial, sans-serif;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 1px 5px rgb(0 0 0 / 40%);
}
</style>
