/**
 * What is behind an open dialog, the command palette or the phone's navigation drawer is made `inert`, so a screen
 * reader's browse mode or TalkBack cannot wander out of it into the page underneath. Each holds a layer while it is
 * open; only the newest layer stays live, so with dialogs stacked the one beneath is inert too until the top one closes.
 *
 * Everything outside the layer is marked: every sibling of the layer and of each of its ancestors up to <body>. Only
 * the attributes set here are removed again, so an element something else made inert stays inert. A WebView too old
 * to know `inert` ignores the attribute and keeps the dialog's aria-modal.
 *
 * An element marked `data-layer-exempt` stays live under every layer, along with what is inside it: the notifications
 * column (`ActionToasts`), which is drawn above the palette and the drawer, has buttons that must still take a click, and
 * holds the live regions that announce an action's progress and a failure. Its ancestors stay live too (only their other
 * children are marked), since an inert ancestor would take it with it. One inside the layer is already live.
 *
 * Release the layer before giving focus back to what opened it: an inert element cannot take focus.
 */

/** The attribute that keeps an element live while a layer is held. */
export const LAYER_EXEMPT_ATTR = 'data-layer-exempt'

const layers: HTMLElement[] = []
const marked = new Set<Element>()

function apply() {
  for (const el of marked) el.removeAttribute('inert')
  marked.clear()
  const top = layers[layers.length - 1]
  if (!top?.isConnected) return
  const body = document.body
  // What stays live: the layer, and each exempt element outside it.
  const keep = new Set<Element>([top])
  for (const el of Array.from(document.querySelectorAll(`[${LAYER_EXEMPT_ATTR}]`))) {
    if (!top.contains(el)) keep.add(el)
  }
  // Their ancestors, up to <body>: the elements whose other children are marked.
  const path = new Set<Element>()
  for (const el of keep) {
    if (el === body || !body.contains(el)) continue
    for (let node = el.parentElement; node; node = node.parentElement) {
      path.add(node)
      if (node === body) break
    }
  }
  for (const parent of path) {
    for (const child of Array.from(parent.children)) {
      if (keep.has(child) || path.has(child) || child.hasAttribute('inert') || child instanceof HTMLScriptElement) continue
      child.setAttribute('inert', '')
      marked.add(child)
    }
  }
}

/** Make everything but `el` (and what is marked `data-layer-exempt`) inert until the returned function is called. */
export function holdLayer(el: HTMLElement): () => void {
  layers.push(el)
  apply()
  return () => {
    const at = layers.lastIndexOf(el)
    if (at === -1) return
    layers.splice(at, 1)
    apply()
  }
}

/** Whether `el` is the newest layer, the one keys like Escape belong to. */
export function isTopLayer(el: Element | null | undefined): boolean {
  return !!el && layers[layers.length - 1] === el
}

/** The newest layer, or null when none is held. */
export function topLayer(): HTMLElement | null {
  return layers[layers.length - 1] ?? null
}

/** How many layers are held: a dialog, the palette or the drawer each hold one while open. */
export function layerCount(): number {
  return layers.length
}
