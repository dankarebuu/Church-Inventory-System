import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
