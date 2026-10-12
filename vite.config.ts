import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
  // Относительные адреса: сборка работает и в корне домена,
  // и в подпапке GitHub Pages (https://<user>.github.io/<repo>/).
  base: './',
})
