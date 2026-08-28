import { defineConfig } from 'vitest/config';

// Separate from vite.config.js on purpose: that config's @vitejs/plugin-react
// conflicts with the rolldown-vite override (root package.json's "overrides")
// during vitest's transform step ("Both esbuild and oxc options were set").
// Test files here are plain JS/utility code, not JSX, so no plugin is needed.
export default defineConfig({
  test: {
    environment: 'node',
  },
});
