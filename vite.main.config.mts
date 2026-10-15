import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Loaded from node_modules at runtime, never bundled: node-pty is native and ssh2 has
      // optional native parts it detects on its own.
      external: ['node-pty', 'ssh2'],
    },
  },
});
