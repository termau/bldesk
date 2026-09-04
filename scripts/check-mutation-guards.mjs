#!/usr/bin/env node
/**
 * Guard rails for FEATURES.md #5 — "every mutation is confirmed in ONE dialog
 * with what will change, and recorded in History".
 *
 * Runs as part of `npm run typecheck` (so CI and the release workflow fail on
 * it). Pure regex over the renderer source; no dependencies. Each rule says
 * what to do instead, because the point is to stop the next contributor (human
 * or agent) from reinventing a dialog, not to be clever.
 *
 * Rules:
 *  1. No window.confirm / confirm( / alert-as-confirm outside ConfirmContext.
 *  2. One dialog shell: `createPortal(` only inside components/ui/Modal.tsx.
 *     Every dialog is a <Modal>; confirmations are useConfirm() on top.
 *  3. Every mutation call (client.POST/PUT/DELETE/PATCH, .mutate, .mutateAsync)
 *     must have confirmAction()/recordChange() earlier in the same handler, or
 *     `// history: n/a — <reason>` on the line above. Transport/shim files are
 *     allow-listed with a reason.
 *  4. `track(` calls that submit an action from a confirmed flow should pass
 *     the changeId (4th arg) — warned, not failed, because diagnostics and
 *     unconfirmed flows legitimately omit it.
 *  5. `useServers()` is called only from App.tsx; everything else takes
 *     `servers` as a prop.
 *  6. An id from recordChange() must reach updateChange() or track() and must
 *     not be `void`ed — otherwise the entry never leaves "Submitted".
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src/renderer/src')

// Files allowed to mutate without going through the confirm dialog, with why.
const MUTATION_EXCEPTIONS = {
  'api/queries.ts': 'hooks only; call sites confirm',
  'api/client.ts': 'transport',
  'api/mobile-bridge.ts': 'platform shim',
  'context/ConfirmContext.tsx': 'is the dialog',
  'context/ActionTrackerContext.tsx': 'reports outcomes; does not start actions',
  'lib/powerState.ts': 'is_running diagnostic — changes nothing',
  'lib/deeplinks.ts': 'console URL fetch and SSH launch — read-only',
  'components/auth/AuthModal.tsx': 'GET /v2/account token validation only',
  'components/servers/CreateServerModal.tsx': 'create form records via recordChange; no confirm by design (the form is the review)'
}

const SHARED_DIALOG = 'context/ConfirmContext.tsx'
const MODAL_SHELL = 'components/ui/Modal.tsx'

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(tsx?|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(p)
  }
  return out
}

const failures = []
const warnings = []

for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, '/')
  const src = readFileSync(file, 'utf8')
  // Blank out comments but keep line numbers: block comments may span lines.
  const lines = src.split('\n')
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
  const codeOnly = stripped.split('\n')
  const isSharedDialog = rel === SHARED_DIALOG

  // 1. Native confirm boxes
  if (!isSharedDialog) {
    codeOnly.forEach((l, i) => {
      if (/\bwindow\.confirm\s*\(|(^|[^A-Za-z_.])confirm\s*\(/.test(l) && !/confirmAction|useConfirm|Confirm\(/.test(l)) {
        failures.push(`${rel}:${i + 1}: native confirm() — use useConfirm() from context/ConfirmContext (severity, summary, changes/diff, typeToConfirm) so it is reviewed and recorded in History.`)
      }
    })
  }

  // 2. One dialog shell. Every dialog is a <Modal> (components/ui/Modal.tsx),
  //    so they all look and behave the same; anything that changes something
  //    goes through useConfirm() on top of it. A createPortal anywhere else is
  //    a new kind of dialog.
  if (rel !== MODAL_SHELL && /createPortal\s*\(/.test(codeOnly.join('\n'))) {
    failures.push(`${rel}: createPortal outside the shared shell — render a <Modal> from components/ui/Modal.tsx instead (title, icon, footer, size, as="form"). Mutations still go through useConfirm().`)
  }
  if (rel !== MODAL_SHELL && rel !== SHARED_DIALOG && /fixed inset-0[^"'`]*(bg-black\/|backdrop)/.test(src) && /role="dialog"|aria-modal/.test(src)) {
    failures.push(`${rel}: hand-rolled modal overlay — use <Modal> from components/ui/Modal.tsx.`)
  }

  // 3. Every mutation call must be confirmed or recorded in the handler that
  //    makes it. Per call, not per file: one confirmed action in a file must
  //    not launder an unconfirmed one next to it. A call that genuinely needs
  //    neither carries `// history: n/a — <reason>` on the line above.
  if (!isSharedDialog && !(rel in MUTATION_EXCEPTIONS)) {
    const MUTATION_CALL = /client\.(POST|PUT|DELETE|PATCH)\s*\(|\.mutateAsync\s*\(|\.mutate\s*\(/
    const GUARD = /confirmAction\s*\(|useConfirm\(\)\s*\(|recordChange\s*\(/
    const LOOKBACK = 80
    codeOnly.forEach((l, i) => {
      if (!MUTATION_CALL.test(l)) return
      const marker = /history:\s*n\/a/i.test(lines[i - 1] ?? '') || /history:\s*n\/a/i.test(lines[i] ?? '')
      if (marker) return
      // Walk back to the start of the enclosing handler: the nearest line that
      // declares a function/handler at a shallower indent than the call.
      const indent = (l.match(/^\s*/) ?? [''])[0].length
      let guarded = false
      for (let k = i - 1; k >= 0 && i - k <= LOOKBACK; k--) {
        const prev = codeOnly[k]
        if (GUARD.test(prev)) {
          guarded = true
          break
        }
        const pIndent = (prev.match(/^\s*/) ?? [''])[0].length
        const startsHandler = /(const|let|function)\s+\w+\s*=?\s*(async\s*)?(\(|function)|=>\s*\{?\s*$/.test(prev)
        if (prev.trim() && pIndent < indent && startsHandler && pIndent <= 2) break
      }
      if (!guarded) {
        failures.push(`${rel}:${i + 1}: mutation without a confirm or a History record in its handler — call confirmAction() (or recordChange() for flows the form itself reviews) before it, pass the changeId on, or mark the line above with \`// history: n/a — <why>\`.`)
      }
    })
  }

  // 6. A recorded change must be resolved: the id from recordChange() has to
  //    reach updateChange() or track() somewhere below, and must not be thrown
  //    away with `void`. Otherwise History shows "Submitted" forever (#23).
  codeOnly.forEach((l, i) => {
    const m = /(?:const|let)\s+(\w+)\s*=\s*await\s+recordChange\s*\(/.exec(l)
    if (!m) return
    const id = m[1]
    const rest = codeOnly.slice(i + 1, i + 160).join('\n')
    if (new RegExp(`\\bvoid\\s+${id}\\b`).test(rest)) {
      failures.push(`${rel}:${i + 1}: the change id \`${id}\` is discarded with \`void\` — resolve it with updateChange(${id}, { outcome }) or pass it to track() so History gets the outcome.`)
      return
    }
    // Passed into any call downstream counts — updateChange, track, or a local
    // helper that resolves it (e.g. finishFirewall). Never used at all fails.
    const resolved = new RegExp(`\\w+\\([^)]*\\b${id}\\b`).test(rest)
    if (!resolved) {
      failures.push(`${rel}:${i + 1}: \`${id}\` from recordChange() is never passed anywhere — the History entry will sit at "Submitted" forever. Resolve it with updateChange()/track() on success and on failure.`)
    }
  })

  // 5. Only App.tsx may call useServers(): a second observer on the same cache
  //    key replaces the shared query's function (AGENTS.md rule 8).
  if (rel !== 'App.tsx' && rel !== 'api/queries.ts') {
    codeOnly.forEach((l, i) => {
      if (/\buseServers\s*\(/.test(l)) {
        failures.push(`${rel}:${i + 1}: useServers() outside App.tsx — take \`servers\` as a prop instead (App passes the cached, power-annotated list). See AGENTS.md rule 8.`)
      }
    })
  }

  // 4. track() without changeId (warn). Count top-level commas with balanced
  //    brackets so `track(x, f(y), z, id)` is four arguments, not three.
  const countArgs = (text) => {
    let depth = 0
    let n = text.trim() ? 1 : 0
    for (const ch of text) {
      if (ch === '(' || ch === '[' || ch === '{') depth++
      else if (ch === ')' || ch === ']' || ch === '}') depth--
      else if (ch === ',' && depth === 0) n++
    }
    return n
  }
  codeOnly.forEach((l, i) => {
    const at = l.search(/\btrack\(/)
    if (at < 0 || rel === 'context/ActionTrackerContext.tsx') return
    let depth = 0
    let end = -1
    for (let k = at + 'track'.length; k < l.length; k++) {
      if (l[k] === '(') depth++
      else if (l[k] === ')') {
        depth--
        if (depth === 0) {
          end = k
          break
        }
      }
    }
    if (end < 0) return // multi-line call; skip rather than guess
    const inner = l.slice(at + 'track('.length, end)
    if (countArgs(inner) > 0 && countArgs(inner) < 4 && /useConfirm\(|recordChange\(/.test(src)) {
      warnings.push(`${rel}:${i + 1}: track() without a changeId — pass the id from confirm()/recordChange() (4th arg) so History gets the outcome.`)
    }
  })
}

// Stale exceptions are noise; say so.
for (const rel of Object.keys(MUTATION_EXCEPTIONS)) {
  try {
    statSync(join(SRC, rel))
  } catch {
    warnings.push(`MUTATION_EXCEPTIONS lists ${rel}, which no longer exists — remove it.`)
  }
}

for (const w of warnings) console.warn(`warn  ${w}`)
if (failures.length) {
  console.error('\nMutation-guard check failed (FEATURES.md #5):\n')
  for (const f of failures) console.error(`  ✗ ${f}`)
  console.error(`\n${failures.length} problem${failures.length === 1 ? '' : 's'}. See AGENTS.md → "Mutations, confirmation and History".`)
  process.exit(1)
}
console.log(`mutation guards ok (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`)
