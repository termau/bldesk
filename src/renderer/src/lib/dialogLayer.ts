/**
 * What is behind an open dialog, the command palette or the phone's navigation drawer is made `inert`, so a screen
 * reader's browse mode or TalkBack cannot wander out of it into the page underneath. Each holds a layer while it is
 * open; only the newest layer stays live, so with dialogs stacked the one beneath is inert too until the top one closes.
 *
 * Everything outside the layer is marked: every sibling of the layer and of each of its ancestors up to <body>. Only
 * the attributes set here are removed again, so an element something else made inert stays inert. A WebView too old
 * to know `inert` ignores the attribute and keeps the dialog's aria-modal.
 *
 * Release the layer before giving focus back to what opened it: an inert element cannot take focus.
 */

const layers: HTMLElement[] = []
const marked = new Set<Element>()

function apply() {
  for (const el of marked) el.removeAttribute('inert')
  marked.clear()
  const top = layers[layers.length - 1]
  if (!top?.isConnected) return
  for (let node: Element = top; node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (sibling === node || sibling.hasAttribute('inert') || sibling instanceof HTMLScriptElement) continue
      sibling.setAttribute('inert', '')
      marked.add(sibling)
    }
  }
}

/** Make everything but `el` inert until the returned function is called. */
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
