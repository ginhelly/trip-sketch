import type { Ref } from 'vue'

import { createId } from '../storage'

import type {
  TravelOption,
  TravelOptionId,
  TripEdge,
  TripProject,
} from '../types'

export interface UseTravelOptionsOptions {
  project: Ref<TripProject>
  selectedEdge: Readonly<Ref<TripEdge | null>>
  confirm: (message: string) => boolean
}

export function useTravelOptions(options: UseTravelOptionsOptions) {
  const { project, selectedEdge, confirm } = options

  // Последнее введённое локальное отправление: новый вариант
  // начинается с него, чтобы не вводить дату с нуля.
  let lastDeparture = ''

  function lastKnownDeparture(): string {
    if (lastDeparture) return lastDeparture

    for (const edge of [...project.value.edges].reverse()) {
      for (const option of [...edge.options].reverse()) {
        if (option.departure.localDateTime) {
          return option.departure.localDateTime
        }
      }
    }

    return ''
  }

  function updateTravelOption(option: TravelOption): void {
    const edge = selectedEdge.value
    if (!edge) return

    const index = edge.options.findIndex(
      (item) => item.id === option.id,
    )

    if (index === -1) return

    if (option.departure.localDateTime) {
      lastDeparture = option.departure.localDateTime
    }

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

    const previous = lastKnownDeparture()

    edge.options.push({
      id: createId(),
      name: '',
      descriptionMarkdown: '',
      cost: 0,
      departure: {
        localDateTime: previous,
        timeZone: from?.timeZone ?? '',
        disambiguation: 'reject',
      },
      arrival: {
        localDateTime: previous,
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

  function deleteOption(optionId: TravelOptionId): void {
    const edge = selectedEdge.value
    if (!edge) return

    if (!confirm('Удалить этот вариант проезда?')) return

    edge.options = edge.options.filter((option) => option.id !== optionId)
  }

  return {
    addOption,
    duplicateOption,
    updateTravelOption,
    deleteOption,
  }
}
