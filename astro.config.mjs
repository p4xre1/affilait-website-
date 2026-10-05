import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://fatorati.me',
  output: 'static',
  trailingSlash: 'always',
  vite: {
    server: {
      host: '0.0.0.0',
      // The live preview is proxied through an Arena host, not localhost.
      allowedHosts: true,
    },
  },
});
