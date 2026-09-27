import { defineConfig } from 'vite';

// The game client: the game itself plus the big-screen board (/tv).
export default defineConfig({
  build: {
    outDir: 'dist/client',
    rolldownOptions: {
      input: { main: 'index.html', tv: 'tv.html' },
    },
  },
});
