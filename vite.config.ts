import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Strict Content-Security-Policy, injected into production builds only
 * (the dev server needs inline scripts for hot reload).
 * Hosts that support response headers should also send public/_headers.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function securityHeaders(): Plugin {
  return {
    name: 'det-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}">`,
      );
    },
  };
}

export default defineConfig({
  // BASE_PATH lets the same build run at a domain root or under /RepoName/ on GitHub Pages.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), securityHeaders()],
  build: {
    target: 'es2022',
    sourcemap: false,
    // Keep everything as files so the CSP can stay 'self'-only.
    assetsInlineLimit: 0,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
