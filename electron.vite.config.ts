import { resolve } from 'path'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const { version: APP_VERSION } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
type BuildFlavor = 'production' | 'local'

function resolveBuildFlavor(command: 'build' | 'serve', mode: string): BuildFlavor {
  // Flavor is a command-line build decision, never a runtime environment
  // switch. Dev/preview always use the local identity; distributable bundles
  // must explicitly use either --mode production or --mode localdev.
  if (command === 'serve') return 'local'
  if (mode === 'production') return 'production'
  if (mode === 'localdev') return 'local'
  throw new Error(`Unsupported BLDesk build mode "${mode}". Use "production" or "localdev".`)
}

function buildFlavorMarkerPlugin(flavor: BuildFlavor): Plugin {
  return {
    name: 'bldesk-build-flavor-marker',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-flavor.json',
        source: `${JSON.stringify({ flavor })}\n`
      })
    }
  }
}

// Plugin to strip `crossorigin` attributes so Chromium allows file:// script loading in packaged Electron
function removeCrossoriginPlugin() {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html: string) {
      return html.replace(/\s+crossorigin(?:="[^"]*"|='[^']*'|(?=[\s>]))?/g, '')
    }
  }
}

export default defineConfig(({ command, mode }) => {
  const buildFlavor = resolveBuildFlavor(command, mode)

  return {
    main: {
      plugins: [externalizeDepsPlugin(), buildFlavorMarkerPlugin(buildFlavor)],
      define: {
        __BLDESK_BUILD_FLAVOR__: JSON.stringify(buildFlavor)
      },
      build: {
        rollupOptions: {
          // Keep storage setup in a tiny bootstrap. The actual application is a
          // dynamic import, so no module that may touch Electron paths can
          // evaluate before dev/preview userData and sessionData are isolated.
          input: {
            index: resolve('src/main/bootstrap.ts')
          }
        }
      },
      resolve: {
        alias: {
          '@shared': resolve('src/shared')
        }
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      // Sandboxed Electron preload scripts run as CommonJS and only receive the
      // restricted preload `require`. An ESM `.mjs` preload builds successfully
      // but fails at runtime before contextBridge can expose the API.
      build: {
        rollupOptions: {
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs'
          }
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
        strictPort: false
      },
      define: {
        __APP_VERSION__: JSON.stringify(APP_VERSION)
      },
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react(), removeCrossoriginPlugin()]
    }
  }
})
