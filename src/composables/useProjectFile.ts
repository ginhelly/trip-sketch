import { onScopeDispose } from 'vue'
import type { Ref } from 'vue'

import {
  createEmptyProject,
  exportProject,
  importProjectFile,
} from '../storage'

import type {
  TripProject,
  ValidationIssue,
} from '../types'

export interface UseProjectFileOptions {
  project: Ref<TripProject>
  notify: (message: string) => void
  confirm: (message: string) => boolean
  /** Заменяет проект и сбрасывает состояние интерфейса. */
  replaceProject: (next: TripProject) => void
}

export function useProjectFile(options: UseProjectFileOptions) {
  const { project, notify, confirm, replaceProject } = options

  let disposed = false

  function newProject(): void {
    if (
      !confirm(
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
      notify(issuesText(result.issues))
    } else {
      notify(
        'JSON подготовлен. Учтите: пользовательские URL подложки экспортируются вместе с проектом.',
      )
    }
  }

  async function importSelectedFile(file: File): Promise<void> {
    const result = await importProjectFile(file)

    if (disposed) return

    if (!result.ok) {
      notify(`Импорт отклонён: ${issuesText(result.issues)}`)
      return
    }

    if (!confirm(`Заменить текущий проект на «${result.value.name}»?`)) {
      return
    }

    replaceProject(result.value)
  }

  onScopeDispose(() => {
    disposed = true
  })

  return {
    newProject,
    exportCurrentProject,
    importSelectedFile,
  }
}

function issuesText(issues: ValidationIssue[]): string {
  return issues.map((issue) => issue.message).join(' ')
}
