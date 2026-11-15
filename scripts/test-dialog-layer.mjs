// What a held layer makes inert, and what Android's Back does about what is open: node --test scripts/test-dialog-layer.mjs
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

/*
 * Just enough of the DOM for lib/dialogLayer.ts and backStep: a tree of elements with attributes, and selectors made of
 * attribute tests ([a], [a="v"]), optionally ":scope > " first, joined with commas.
 */
class El {
  constructor(tag, attrs = {}, children = []) {
    this.tagName = tag.toUpperCase()
    this.attrs = new Map(Object.entries(attrs))
    this.parentElement = null
    this.children = []
    for (const c of children) this.append(c)
  }
  append(c) { c.parentElement = this; this.children.push(c); return c }
  remove() { const p = this.parentElement; if (p) { p.children.splice(p.children.indexOf(this), 1); this.parentElement = null } }
  setAttribute(k, v) { this.attrs.set(k, String(v)) }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null }
  hasAttribute(k) { return this.attrs.has(k) }
  removeAttribute(k) { this.attrs.delete(k) }
  contains(other) { for (let n = other; n; n = n.parentElement) if (n === this) return true; return false }
  get isConnected() { return globalThis.document.documentElement.contains(this) }
  *descendants() { for (const c of this.children) { yield c; yield* c.descendants() } }
  matches(selector) { return parse(selector).some((s) => !s.child && s.tests.every((t) => t(this))) }
  querySelectorAll(selector) {
    const parts = parse(selector)
    return [...this.descendants()].filter((el) => parts.some((s) => (!s.child || el.parentElement === this) && s.tests.every((t) => t(el))))
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null }
}
class Script extends El {}

function parse(selector) {
  return selector.split(',').map((raw) => {
    let part = raw.trim()
    const child = part.startsWith(':scope >')
    if (child) part = part.slice(':scope >'.length).trim()
    const tests = [...part.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map(([, k, v]) => (el) => v === undefined ? el.hasAttribute(k) : el.getAttribute(k) === v)
    assert.equal(part.replace(/\[[^\]]*\]/g, ''), '', `the fake DOM cannot match ${raw}`)
    return { child, tests }
  })
}

let body, root, shell, page, toasts, script
beforeEach(() => {
  page = new El('main')
  toasts = new El('div', { 'data-layer-exempt': '', role: 'region' })
  shell = new El('div', {}, [page, toasts])
  root = new El('div', { id: 'root' }, [shell])
  script = new Script('script')
  body = new El('body', {}, [root, script])
  const html = new El('html', {}, [body])
  globalThis.HTMLScriptElement = Script
  globalThis.document = { documentElement: html, body, querySelectorAll: (s) => html.querySelectorAll(s) }
})

const { holdLayer, isTopLayer, layerCount, topLayer, LAYER_EXEMPT_ATTR } = await import('../src/renderer/src/lib/dialogLayer.ts')
const { backStep, DISMISSIBLE_SELECTOR } = await import('../src/renderer/src/lib/androidBack.ts')
const inert = (el) => el.hasAttribute('inert')

test('the attribute the toasts carry is the one the layer looks for', () => {
  assert.equal(LAYER_EXEMPT_ATTR, 'data-layer-exempt')
})

test('a layer in the app shell (the palette, the drawer) leaves the notifications live, and the page inert', () => {
  const palette = shell.append(new El('div'))
  const release = holdLayer(palette)
  assert.ok(isTopLayer(palette))
  assert.equal(inert(page), true)
  assert.equal(inert(toasts), false, 'the toasts are drawn above the palette and take clicks')
  assert.equal(inert(shell), false, 'an inert ancestor would take the toasts with it')
  assert.equal(inert(root), false)
  assert.equal(inert(script), false)
  release()
  assert.equal(inert(page), false)
  assert.equal(layerCount(), 0)
})

test('a dialog on <body> makes the page inert but not the notifications, and stacked layers keep only the newest live', () => {
  const palette = shell.append(new El('div'))
  const releasePalette = holdLayer(palette)
  const modal = body.append(new El('div'))
  const releaseModal = holdLayer(modal)
  assert.equal(topLayer(), modal)
  assert.equal(layerCount(), 2)
  assert.equal(inert(palette), true, 'the palette under the dialog is inert')
  assert.equal(inert(page), true)
  assert.equal(inert(toasts), false)
  assert.equal(inert(root), false)
  releaseModal()
  assert.equal(inert(palette), false)
  assert.equal(inert(page), true)
  releasePalette()
  assert.equal(inert(page), false)
})

test('with no exempt element on the page, every sibling up to <body> is marked, as before', () => {
  toasts.remove()
  const palette = shell.append(new El('div'))
  const release = holdLayer(palette)
  assert.equal(inert(page), true)
  assert.equal(inert(shell), false)
  assert.equal(inert(root), false)
  release()
})

test('an element something else made inert stays inert after the layer goes', () => {
  page.setAttribute('inert', '')
  const release = holdLayer(shell.append(new El('div')))
  release()
  assert.equal(inert(page), true)
})

// Android Back

const dialog = (dismissible, children = []) => new El('div', { role: 'dialog', 'data-dismissible': dismissible }, children)

test('nothing open: Back goes on to the navigation; a popup on the page is closed first, a listbox included', () => {
  assert.equal(backStep(DISMISSIBLE_SELECTOR, null, body), null)
  const list = page.append(new El('ul', { role: 'listbox', 'data-dismissible': 'true' }))
  assert.equal(backStep(DISMISSIBLE_SELECTOR, null, body), 'popup')
  list.remove()
  page.append(new El('div', { role: 'menu', 'data-dismissible': 'true' }))
  assert.equal(backStep(DISMISSIBLE_SELECTOR, null, body), 'popup')
})

test('a dialog that closes on Escape is closed; one that has to be answered holds Back', () => {
  const overlay = new El('div', {}, [dialog('true')])
  assert.equal(backStep(DISMISSIBLE_SELECTOR, overlay, body), 'layer')
  const prompt = new El('div', {}, [dialog('false')])
  assert.equal(backStep(DISMISSIBLE_SELECTOR, prompt, body), 'hold')
})

test('a popup open on the page under a dialog that has to be answered does not let Back through', () => {
  page.append(new El('div', { role: 'menu', 'data-dismissible': 'true' }))
  const prompt = body.append(new El('div', {}, [dialog('false')]))
  assert.equal(backStep(DISMISSIBLE_SELECTOR, prompt, body), 'hold')
})

test('a popup inside the top dialog is closed before the dialog', () => {
  const overlay = new El('div', {}, [dialog('true', [new El('div', { role: 'menu', 'data-dismissible': 'true' })])])
  assert.equal(backStep(DISMISSIBLE_SELECTOR, overlay, body), 'popup')
})

test('the drawer, whose layer is the dialog itself, is closed', () => {
  assert.equal(backStep(DISMISSIBLE_SELECTOR, dialog('true'), body), 'layer')
})

test('the palette is closed (or steps back) unless a command is running', () => {
  const panel = dialog('true')
  const overlay = new El('div', {}, [panel])
  assert.equal(backStep(DISMISSIBLE_SELECTOR, overlay, body), 'layer')
  panel.setAttribute('data-dismissible', 'false')
  assert.equal(backStep(DISMISSIBLE_SELECTOR, overlay, body), 'hold')
})
