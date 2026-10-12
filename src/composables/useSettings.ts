import { ref, watch } from 'vue'

import { loadSettings, saveSettings } from '../settings'

import type { AppSettings } from '../settings'

/** Настройки сервиса: загружаются из браузера и сохраняются при правке. */
export function useSettings() {
  const settings = ref<AppSettings>(loadSettings())

  watch(settings, (value) => saveSettings(value), { deep: true })

  return { settings }
}
