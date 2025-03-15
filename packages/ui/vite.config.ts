/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { join } from 'path';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';

export default defineConfig({
  plugins: [
    react(),
    nxViteTsPaths(),
  ],
  // 配置Vitest
  test: {
    globals: true,
    cache: {
      dir: '../../node_modules/.vitest',
    },
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
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
    sourcemap: true,
    minify: false,
    // 确保输出路径与NX配置一致
    outDir: '../../dist/packages/ui',
  },
}); 