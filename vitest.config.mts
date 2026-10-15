import { defineConfig } from 'vitest/config';

// Main-process and shared code; renderer behaviour is verified in the running app.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
