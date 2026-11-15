import { dirname, resolve } from 'path'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { packageFolderOf } from './scripts/notices'

const { version: APP_VERSION } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

// Plugin to strip `crossorigin` attributes so Chromium allows file:// script loading in packaged Electron
function removeCrossoriginPlugin() {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin(?:="[^"]*"|='[^']*'|(?=[\s>]))?/g, '')
    }
  }
}

/*
 * Content Security Policy, for builds only: the dev server injects inline
 * scripts and a websocket that this would block. The renderer holds the API
 * token, so script may come only from the app itself, and requests may go only
 * to the services the app talks to. Styles stay 'unsafe-inline' because React
 * style props and xterm's injected stylesheet need it. The Android build shares
 * this output; Capacitor's own bridge is injected natively, not as page script.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // No 'self': for a page loaded from file://, 'self' also matches every other
  // file: URL, so fetch('file:///...') could read local files. The renderer
  // never fetches its own files; scripts and styles are covered above.
  // The one localhost path is Capacitor's native HTTP proxy on Android:
  // CapacitorHttp routes fetch() through https://localhost/_capacitor_http_interceptor_,
  // so without it every fetch on Android (the update check among them) is
  // refused. A path, not the origin, so nothing else on localhost is allowed.
  "connect-src https://api.binarylane.com.au https://api.github.com https://uai.adamhomenet.com https://localhost/_capacitor_http_interceptor_",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  // Script-injection sinks (innerHTML and the like) accept only values from a named policy. The one policy is the
  // release-notes parser in UpdateMenu.tsx, which parses notes into a detached document and rebuilds them as React elements.
  "require-trusted-types-for 'script'",
  "trusted-types bldesk-release-notes"
].join('; ')

function contentSecurityPolicyPlugin() {
  return {
    name: 'content-security-policy',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`)
    }
  }
}

/*
 * The build strips licence comments from the code it bundles, so the packages' own licence text is collected separately
 * (scripts/notices.ts, scripts/write-notices.mjs). Each build records which packages it bundled; `npm run build` then
 * writes THIRD_PARTY_NOTICES.txt from the three records.
 */
const BUNDLED_RECORD = resolve('out/bundled-modules.json')
function recordBundledModules(build: 'main' | 'preload' | 'renderer') {
  return {
    name: 'record-bundled-modules',
    apply: 'build' as const,
    generateBundle(_options: unknown, bundle: Record<string, { type: string; moduleIds?: string[] }>) {
      const folders = new Set<string>()
      for (const item of Object.values(bundle)) {
        for (const id of item.type === 'chunk' ? (item.moduleIds ?? []) : []) {
          const folder = packageFolderOf(id, process.cwd())
          if (folder) folders.add(folder)
        }
      }
      let record: Record<string, string[]> = {}
      try {
        record = JSON.parse(readFileSync(BUNDLED_RECORD, 'utf8'))
      } catch {
        /* the first build to run starts a new record */
      }
      record[build] = [...folders].sort()
      mkdirSync(dirname(BUNDLED_RECORD), { recursive: true })
      writeFileSync(BUNDLED_RECORD, JSON.stringify(record, null, 2))
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), recordBundledModules('main')],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin(), recordBundledModules('preload')],
    // CommonJS, as index.cjs: the renderer is sandboxed, and a sandboxed
    // preload cannot be an ES module (package.json "type": "module" would
    // otherwise make electron-vite emit index.mjs).
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  renderer: {
    base: './',
    /*
     * Vite's default 5173 is unusable on Windows machines with Hyper-V or WSL:
     * those reserve blocks of ports, and 5173 falls inside 5141-5240 on at least
     * one dev box, so `npm run dev` dies with EACCES before the window opens.
     * Overridable rather than moved, so the default stays familiar.
     */
    server: {
      port: Number(process.env.BLDESK_DEV_PORT) || 5173,
      fs: { allow: [resolve('.')] },
      strictPort: false
    },
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION)
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@help': resolve('docs/help'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), removeCrossoriginPlugin(), contentSecurityPolicyPlugin(), recordBundledModules('renderer')]
  }
})
