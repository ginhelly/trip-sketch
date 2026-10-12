import { describe, expect, it } from 'vitest'

import { createEmptyProject, validateProject } from './storage'

import type { TripNode } from './types'

function node(): Omit<TripNode, 'layover'> {
  return {
    id: 'n1',
    name: 'Москва',
    coordinates: { lng: 37.6, lat: 55.7 },
    region: '',
    country: '',
    timeZone: 'Europe/Moscow',
    timeZoneSource: 'manual',
    minimumTransferMinutes: 0,
  }
}

describe('миграция схемы', () => {
  it('проект версии 1 получает обычный режим пересадки', () => {
    const v1 = {
      ...createEmptyProject(),
      schemaVersion: 1,
      nodes: [node()],
    }

    const result = validateProject(v1)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.value.schemaVersion).toBe(2)
      expect(result.value.nodes[0]!.layover).toEqual({
        mode: 'regular',
        options: [],
      })
    }
  })

  it('сохраняет и восстанавливает варианты проживания', () => {
    const project = {
      ...createEmptyProject(),
      nodes: [
        {
          ...node(),
          layover: {
            mode: 'extended',
            options: [
              {
                id: 's1',
                name: 'Хостел',
                descriptionMarkdown: '[сайт](https://example.com)',
                pricing: 'per-night',
                rate: 15,
                enabled: true,
              },
            ],
          },
        },
      ],
    }

    const first = validateProject(JSON.parse(JSON.stringify(project)))
    expect(first.ok).toBe(true)

    if (first.ok) {
      expect(first.value.nodes[0]!.layover).toEqual(
        project.nodes[0]!.layover,
      )
    }
  })

  it('отклоняет некорректный вариант проживания', () => {
    const project = {
      ...createEmptyProject(),
      nodes: [
        {
          ...node(),
          layover: {
            mode: 'extended',
            options: [
              {
                id: 's1',
                name: '',
                descriptionMarkdown: '',
                pricing: 'per-week',
                rate: -1,
                enabled: true,
              },
            ],
          },
        },
      ],
    }

    const result = validateProject(project)

    expect(result.ok).toBe(false)

    if (!result.ok) {
      const fields = result.issues.map((issue) => issue.field)
      expect(fields).toContain('nodes[0].layover.options[0].pricing')
      expect(fields).toContain('nodes[0].layover.options[0].rate')
    }
  })
})
