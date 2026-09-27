import { defineConfig } from 'vite';

// The arena server + CLI, bundled into one Node file (dist/server/cli.js). It imports the same
// engine as the game to verify replays; Node built-ins (node:sqlite, node:http…) stay external,
// so the published package has no runtime dependencies.
export default defineConfig({
  publicDir: false,
  build: {
    ssr: 'server/cli.ts',
    outDir: 'dist/server',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rolldownOptions: {
      output: {
        entryFileNames: 'cli.js',
        banner: '#!/usr/bin/env node',
      },
    },
  },
});
