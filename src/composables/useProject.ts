import { onScopeDispose, ref, watch } from 'vue'

import {
  createEmptyProject,
  loadProject,
  saveProject,
} from '../storage'

import type {
  TripProject,
  ValidationIssue,
} from '../types'

export function useProject() {
  const loaded = loadProject()

  const project = ref<TripProject>(
    loaded.ok ? loaded.value : createEmptyProject(),
  )

  const storageBlocked = ref(!loaded.ok)

  const storageMessage = ref(
    loaded.ok
      ? 'Проект загружен'
      : `Автосохранение отключено: ${issuesText(loaded.issues)}`,
  )

  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function clearSaveTimer(): void {
    if (saveTimer !== undefined) {
      clearTimeout(saveTimer)
      saveTimer = undefined
    }
  }

  function saveNow(): void {
    clearSaveTimer()

    if (storageBlocked.value) return

    const result = saveProject(project.value)

    if (result.ok) {
      storageMessage.value =
        `Сохранено ${new Date().toLocaleTimeString('ru-RU')}`
    } else {
      storageMessage.value =
        `Не сохранено: ${issuesText(result.issues)}`
    }
  }

  function scheduleSave(): void {
    if (disposed || storageBlocked.value) return

    clearSaveTimer()

    storageMessage.value = 'Сохранение…'
    saveTimer = setTimeout(saveNow, 500)
  }

  const stopWatching = watch(
    project,
    scheduleSave,
    {
      deep: true,
      flush: 'sync',
    },
  )

  function replaceStoredProject(next: TripProject): void {
    if (disposed) return

    clearSaveTimer()

    project.value = next
    storageBlocked.value = false

    saveNow()
  }

  function handleBeforeUnload(): void {
    saveNow()
  }

  window.addEventListener('beforeunload', handleBeforeUnload)

  onScopeDispose(() => {
    disposed = true
    stopWatching()

    window.removeEventListener(
      'beforeunload',
      handleBeforeUnload,
    )

    saveNow()
  })

  return {
    project,
    storageBlocked,
    storageMessage,
    saveNow,
    replaceStoredProject,
  }
}

function issuesText(issues: ValidationIssue[]): string {
  return issues.map((issue) => issue.message).join(' ')
}