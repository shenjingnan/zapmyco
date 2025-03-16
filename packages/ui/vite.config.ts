/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { join, resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  build: {
    lib: {
      entry: join(__dirname, 'src/index.ts'),
      name: 'ZapmycoUI',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'clsx', 'tailwind-merge'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'clsx': 'clsx',
          'tailwind-merge': 'tailwindMerge'
        },
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
}); 