import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { viteSingleFile } from 'vite-plugin-singlefile'

/**
 * Two shipping shapes, one codebase:
 *
 *   vite build                  -> dist/          hosted app, installable, updates itself
 *   vite build --mode offline   -> dist-offline/  one self-contained .html file
 *
 * The offline build exists because a downloaded file is an artifact: it can be
 * hashed, archived and attached to a validation record, and it keeps reporting
 * what it reported on the day it was filed. The hosted build is the low-friction
 * way in for everyone who just wants to compare two documents today.
 */

/**
 * A document under review must not leave the machine, and saying so in a README
 * is not evidence. This policy makes the browser enforce it: no origin the page
 * could talk to is ever allowed, so a network call is not a bug waiting to be
 * noticed, it is a blocked request in the console.
 *
 * What the app genuinely needs, and why each entry is here:
 *  - 'unsafe-inline' styles: the print/HTML report is built as one document with
 *    its own <style> block, and React writes inline style attributes.
 *  - blob: everywhere the exports live — HTML and ODT downloads are blob URLs.
 *  - connect-src is the whole privacy claim. Hosted, it is 'self' because the
 *    service worker fetches the app's own files to cache them. Offline, there
 *    is nothing legitimate left to fetch, so it is 'none'.
 */
function contentSecurityPolicy(offline: boolean): string {
  return [
    "default-src 'self'",
    // The offline build is one file: its script is inlined, and file:// pages
    // have an opaque origin that 'self' does not match.
    offline ? "script-src 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    offline ? "connect-src 'none'" : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    // frame-ancestors is deliberately absent: browsers ignore it in a <meta>
    // tag, so putting it here only produces a console warning. It is delivered
    // as a real header instead, by public/_headers, on hosts that support one.
  ].join('; ')
}

/**
 * The offline build copies nothing from public/, so the one asset the page
 * still references — its own icon — has to travel inside the HTML.
 */
function inlineFavicon(): Plugin {
  return {
    name: 'docr3v-inline-favicon',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        const svg = readFileSync(new URL('./public/favicon.svg', import.meta.url), 'utf8')
        return html.replace(
          './favicon.svg',
          `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`,
        )
      },
    },
  }
}

/**
 * The offline build has no service worker, so the module the app registers one
 * through does not exist there. This stands in for it with a registration that
 * does nothing.
 */
function noServiceWorker(): Plugin {
  const id = 'virtual:pwa-register'
  return {
    name: 'docr3v-no-service-worker',
    resolveId: (source) => (source === id ? `\0${id}` : undefined),
    load: (resolved) =>
      resolved === `\0${id}` ? 'export const registerSW = () => async () => {}' : undefined,
  }
}

function injectCsp(offline: boolean): Plugin {
  return {
    name: 'docr3v-csp',
    // Built output only. The dev server serves inline scripts of its own — the
    // React Fast Refresh preamble among them — so injecting `script-src 'self'`
    // here stops `npm run dev` from rendering anything at all. The policy
    // protects what ships; it is not a thing to develop against.
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(offline)}" />`,
        ),
    },
  }
}

const pwa = () =>
  VitePWA({
    // 'prompt' rather than 'autoUpdate': the app decides when a new version
    // takes over, so it never reloads under a comparison in progress. See
    // src/services/appUpdate.ts, which also does the registering — bundled
    // with the app, so script-src stays free of 'unsafe-inline'.
    registerType: 'prompt',
    injectRegister: false,
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'DocR3V — Document comparison',
      short_name: 'DocR3V',
      description:
        'Word-level comparison of two revisions of the same document. Runs entirely on your computer.',
      // Matches the icon ground and the app's ink colour; the app itself is a
      // light document surface, so the splash stays white.
      theme_color: '#1f2937',
      background_color: '#ffffff',
      display: 'standalone',
      start_url: './',
      scope: './',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
        {
          src: 'icon-maskable-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'maskable',
        },
      ],
    },
    workbox: {
      // Everything the app is, precached — after the first visit it opens with
      // no network at all.
      globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      // The bundle is a single chunk well over the 2 MB default.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    },
  })

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const offline = mode === 'offline'

  return {
    plugins: [
      react(),
      tailwindcss(),
      ...(offline ? [viteSingleFile(), inlineFavicon(), noServiceWorker()] : [pwa()]),
      injectCsp(offline),
    ],
    // Nothing may be copied alongside the offline build: a file sitting next to
    // the HTML is a file that will not be there once someone has downloaded it.
    ...(offline ? { publicDir: false as const } : {}),
    // The app is a pure static bundle: all document parsing and diffing happens
    // in the browser, so there is no server component to configure. Relative
    // paths let the same build run from a file:// path, a web root, or a
    // project subdirectory; PUBLIC_BASE overrides it for GitHub Pages, where
    // the service worker needs to know its real scope.
    base: offline ? './' : (process.env.PUBLIC_BASE ?? './'),
    build: {
      outDir: offline ? 'dist-offline' : 'dist',
      // One file means one asset: inlining is the point, not a size trade-off.
      assetsInlineLimit: offline ? Number.MAX_SAFE_INTEGER : undefined,
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      setupFiles: ['./src/test/setup.ts'],
    },
  }
})
