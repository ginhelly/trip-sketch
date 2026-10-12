<script setup lang="ts">
import { computed, ref } from 'vue'
import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

const props = defineProps<{
  modelValue: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

type NotesMode = 'closed' | 'edit' | 'preview'

const mode = ref<NotesMode>(props.modelValue ? 'preview' : 'closed')

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const defaultLinkRenderer = markdown.renderer.rules.link_open

markdown.renderer.rules.link_open = (
  tokens,
  index,
  options,
  env,
  renderer,
) => {
  const token = tokens[index]

  if (token) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  }

  return defaultLinkRenderer
    ? defaultLinkRenderer(tokens, index, options, env, renderer)
    : renderer.renderToken(tokens, index, options)
}

const html = computed(() =>
  DOMPurify.sanitize(markdown.render(props.modelValue), {
    ADD_ATTR: ['target', 'rel'],
  }),
)

function update(event: Event): void {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <div class="opt-notes">
    <button
      v-if="mode === 'closed'"
      type="button"
      class="link-button"
      @click="mode = 'edit'"
    >
      + Заметка
    </button>

    <template v-else>
      <div class="opt-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'edit'"
          :class="{ active: mode === 'edit' }"
          @click="mode = 'edit'"
        >
          Правка
        </button>

        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'preview'"
          :class="{ active: mode === 'preview' }"
          @click="mode = 'preview'"
        >
          Просмотр
        </button>
      </div>

      <textarea
        v-if="mode === 'edit'"
        :value="modelValue"
        rows="4"
        aria-label="Заметки в Markdown"
        placeholder="Markdown: [Билеты](https://...)"
        @input="update"
      />

      <div
        v-else-if="modelValue.trim()"
        class="markdown-content"
        v-html="html"
      />

      <p v-else class="muted">
        Заметок пока нет.
      </p>
    </template>
  </div>
</template>
