import { defineConfig } from 'vite';

// Two pages: the piece, and the studio view of the piece.
export default defineConfig({
  server: { port: 5180 },
  build: {
    rollupOptions: {
      input: { main: 'index.html', studio: 'studio.html' },
    },
  },
});
