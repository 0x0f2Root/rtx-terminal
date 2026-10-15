/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />
/// <reference types="vite/client" />
declare module '*.css';

interface Window {
  /** The typed preload API; see src/shared/api.ts. */
  readonly rtx: import('./shared/api').RtxApi;
}
