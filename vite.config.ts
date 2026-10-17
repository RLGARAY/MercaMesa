import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
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
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
})
