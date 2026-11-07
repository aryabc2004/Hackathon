import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const page = (f) => fileURLToPath(new URL(f, import.meta.url));

export default defineConfig({
  build: {
    rollupOptions: {
      input: { main: page('./index.html'), kid: page('./kid.html'), teacher: page('./teacher.html') },
    },
  },
});
