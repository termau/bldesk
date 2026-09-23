import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

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
  "connect-src 'self' https://api.binarylane.com.au https://api.github.com https://uai.adamhomenet.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "form-action 'none'"
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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
    plugins: [react(), removeCrossoriginPlugin(), contentSecurityPolicyPlugin()]
  }
})
