import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

const rawBasePath = process.env.BASE_PATH?.trim() || '/'
const normalizedWithLeading = rawBasePath.startsWith('/') ? rawBasePath : `/${rawBasePath}`
const basePath = normalizedWithLeading.endsWith('/')
  ? normalizedWithLeading
  : `${normalizedWithLeading}/`

// https://vitejs.dev/config/
export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // RNF-3 y SPEC sección 8: nunca recargar en caliente sin permiso
      includeAssets: ['favicon.png', 'icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'MercaMesa - Gestión de Mercadillo',
        short_name: 'MercaMesa',
        description: 'Gestión ágil de inventario y ventas para puesto de mercadillo (offline-first)',
        theme_color: '#f97316',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        lang: 'es',
        start_url: basePath,
        scope: basePath,
        icons: [
          {
            src: `${basePath}icons/icon-192.png`,
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${basePath}icons/icon-512.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: `${basePath}icons/icon-512-maskable.png`,
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: `${basePath}index.html`,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    // Vitest: entorno jsdom para poder testear lógica que usa APIs de navegador
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    env: {
      TZ: 'Europe/Madrid',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
