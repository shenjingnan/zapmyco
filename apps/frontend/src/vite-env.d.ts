/// <reference types="vite/client" />

interface ImportMeta {
  readonly glob: <T>(globPattern: string, options?: { eager?: boolean }) => Record<string, T>;
}
