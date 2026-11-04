// The Enter that opens a dialog must not also answer it: node --test scripts/test-enter-key.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { enterKeyGuard, isEnterDown, watchEnter } from '../src/renderer/src/lib/enterKey.ts'

const key = (type, k) => Object.assign(new Event(type), { key: k })

function setup() {
  const doc = new EventTarget(), win = new EventTarget()
  const watch = watchEnter(doc, win)
  return { doc, win, watch, press: (type, k = 'Enter') => doc.dispatchEvent(key(type, k)) }
}

test('Enter is down from its keydown until its keyup, and no other key counts', () => {
  const { watch, press } = setup()
  assert.equal(watch.isDown(), false)
  press('keydown', 'a'); assert.equal(watch.isDown(), false)
  press('keydown'); assert.equal(watch.isDown(), true)
  press('keydown'); assert.equal(watch.isDown(), true, 'a repeating key stays down')
  press('keyup', 'a'); assert.equal(watch.isDown(), true, 'another key coming up does not release it')
  press('keyup'); assert.equal(watch.isDown(), false)
})

test('losing focus to another window releases it, since its keyup will not arrive here', () => {
  const { watch, win, press } = setup()
  press('keydown')
  win.dispatchEvent(new Event('blur'))
  assert.equal(watch.isDown(), false)
})

test('stopping the watch removes every listener it added, with the same capture flag', () => {
  const calls = []
  const fake = { addEventListener: (...a) => calls.push(['add', ...a]), removeEventListener: (...a) => calls.push(['remove', ...a]) }
  watchEnter(fake, fake).stop()
  const added = calls.filter((c) => c[0] === 'add'), removed = calls.filter((c) => c[0] === 'remove')
  assert.equal(added.length, 3)
  for (const [, type, listener, capture] of added)
    assert.ok(removed.some(([, t, l, c]) => t === type && l === listener && c === capture), `${type} is removed`)
})

test('outside a browser there is no watch, and Enter is never down', () => {
  assert.equal(isEnterDown(), false)
})

test('a dialog opened while Enter is down cancels that Enter key press, and only until the key is released', () => {
  const guard = enterKeyGuard(true)
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), true)
  assert.equal(guard.cancelsKeyPress({ key: 'a' }), false, 'other keys are never cancelled')
  guard.keyUp({ key: 'a' })
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), true, 'another key coming up does not disarm it')
  guard.keyUp({ key: 'Enter' })
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), false, 'the next Enter is a new key press and is left alone')
})

test('a dialog opened with no Enter down, by a click or by assistive technology, cancels nothing', () => {
  const guard = enterKeyGuard(false)
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), false)
})

test('losing focus disarms it', () => {
  const guard = enterKeyGuard(true)
  guard.reset()
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), false)
})

test('the whole sequence: keydown opens the dialog, its key press is cancelled, a later Enter is not', () => {
  const { watch, press } = setup()
  press('keydown')                              // the keystroke that opens the dialog
  const guard = enterKeyGuard(watch.isDown())   // the dialog mounts inside that keydown
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), true, 'its keypress is the one that would have clicked Confirm')
  press('keyup'); guard.keyUp({ key: 'Enter' })
  press('keydown')                              // the person presses Enter again to confirm
  assert.equal(guard.cancelsKeyPress({ key: 'Enter' }), false)
})

test('the shared Modal shell uses it: it reads Enter when it opens and cancels the key press in the capture phase', () => {
  const modal = readFileSync(fileURLToPath(new URL('../src/renderer/src/components/ui/Modal.tsx', import.meta.url)), 'utf8')
  assert.match(modal, /enterKeyGuard\(isEnterDown\(\)\)/)
  assert.match(modal, /addEventListener\('keypress', onKeyPressCapture, true\)/)
  assert.match(modal, /removeEventListener\('keypress', onKeyPressCapture, true\)/)
  assert.match(modal, /cancelsKeyPress\(e\)/)
})
