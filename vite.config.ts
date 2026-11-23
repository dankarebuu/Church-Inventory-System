import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeManifestIcons: false,
      manifest: {
        name: 'Steward — WIN-GMA Equipment Ops',
        short_name: 'Steward',
        description:
          "Winners Through God's Mighty Arm Community Church — Equipment Inventory, Sunday Checklist & Loan Ops",
        theme_color: '#2563EB',
        background_color: '#0B0F17',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/images/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/images/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/html2pdf-*.js'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/rest\/v1\//, /^\/auth\/v1\//],
        // Explicitly disable runtime caching so Supabase REST/Auth APIs are never cached by SW.
        runtimeCaching: [],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: 'supabase',
              test: /node_modules[\\/]@supabase[\\/]/,
              priority: 20,
            },
            {
              name: 'tanstack',
              test: /node_modules[\\/]@tanstack[\\/]/,
              priority: 20,
            },
            {
              name: 'radix',
              test: /node_modules[\\/]@radix-ui[\\/]/,
              priority: 20,
            },
            {
              name: 'lucide',
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
});
