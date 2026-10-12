<script setup lang="ts">
import { ref } from 'vue'

import type {
  EditorMode,
  GeocodingResult,
} from '../types'

defineProps<{
  projectName: string
  searchQuery: string
  searchResults: GeocodingResult[]
  searchBusy: boolean
  searchError: string
  mode: EditorMode
}>()

const emit = defineEmits<{
  'update:projectName': [name: string]
  'update:searchQuery': [query: string]
  'set-mode': [mode: EditorMode]
  'select-place': [result: GeocodingResult]
  'export-project': []
  'import-project': [file: File]
  'new-project': []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const projectMenu = ref<HTMLDetailsElement | null>(null)

function updateProjectName(event: Event): void {
  emit(
    'update:projectName',
    (event.target as HTMLInputElement).value,
  )
}

function updateSearchQuery(event: Event): void {
  emit(
    'update:searchQuery',
    (event.target as HTMLInputElement).value,
  )
}

function closeMenu(): void {
  if (projectMenu.value) {
    projectMenu.value.open = false
  }
}

function requestExport(): void {
  closeMenu()
  emit('export-project')
}

function requestImport(): void {
  closeMenu()
  fileInput.value?.click()
}

function requestNewProject(): void {
  closeMenu()
  emit('new-project')
}

function handleFileSelected(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  input.value = ''

  if (file) {
    emit('import-project', file)
  }
}
</script>

<template>
  <header class="app-header">
    <div class="app-brand">Trip Sketch</div>

    <input
      :value="projectName"
      class="project-name"
      aria-label="Название проекта"
      placeholder="Название проекта"
      @input="updateProjectName"
    />

    <div class="search-box">
      <input
        :value="searchQuery"
        placeholder="Найти город или место…"
        aria-label="Поиск места"
        autocomplete="off"
        @input="updateSearchQuery"
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
          @click="emit('select-place', result)"
        >
          {{ result.displayName }}
        </button>
      </div>
    </div>

    <div class="toolbar">
      <button
        type="button"
        :class="{ active: mode === 'select' }"
        :aria-pressed="mode === 'select'"
        @click="emit('set-mode', 'select')"
      >
        Выбор
      </button>

      <button
        type="button"
        :class="{ active: mode === 'add-node' }"
        :aria-pressed="mode === 'add-node'"
        @click="emit('set-mode', 'add-node')"
      >
        + Точка
      </button>

      <button
        type="button"
        :class="{ active: mode === 'add-edge' }"
        :aria-pressed="mode === 'add-edge'"
        @click="emit('set-mode', 'add-edge')"
      >
        + Связь
      </button>
    </div>

    <details ref="projectMenu" class="project-menu">
      <summary>Проект</summary>

      <div class="project-menu-content">
        <button type="button" @click="requestExport">
          Экспорт JSON
        </button>

        <button type="button" @click="requestImport">
          Импорт JSON
        </button>

        <button type="button" @click="requestNewProject">
          Новый проект
        </button>
      </div>
    </details>

    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      hidden
      @change="handleFileSelected"
    />
  </header>
</template>