import { Capacitor } from '@capacitor/core'
import { topLayer } from './dialogLayer.ts'

/*
 * What the back button closes before it changes screen: a dialog, or a menu, popover or suggestion list (the tag lists, a rule's
 * address and port lists, a search box's suggestions), that has said it closes on Escape. Back sends it Escape. A popup that sets
 * data-dismissible and a role that is not listed here is skipped, and Back leaves the screen under it; scripts/check-ui-guards.mjs
 * fails on one.
 */
export const DISMISSIBLE_SELECTOR =
  '[role="dialog"][data-dismissible="true"], [role="menu"][data-dismissible="true"], [role="listbox"][data-dismissible="true"]'

/**
 * What Back does about what is open, before it steps back through the app's navigation:
 * - `popup`: a menu, popover or list is open in the top layer (or on the page, with no layer held): Back sends Escape.
 * - `layer`: the top layer itself (a dialog, the palette, the drawer) closes on Escape: Back sends Escape.
 * - `hold`: the top layer has to be answered (`data-dismissible="false"`, such as a question BinaryLane is waiting on, or
 *   the palette while a command runs): Back does nothing, so the screen under it does not change and the app stays open.
 * - `null`: nothing is open.
 *
 * `dismissible` is what Back closes, DISMISSIBLE_SELECTOR. Only the top layer counts: what is under it is inert
 * (lib/dialogLayer.ts). `top` and `root` are for tests.
 */
export type BackStep = 'popup' | 'layer' | 'hold' | null

export function backStep(dismissible: string, top: Element | null = topLayer(), root: ParentNode = document): BackStep {
  if (!top) return root.querySelector(dismissible) ? 'popup' : null
  // A dialog's layer is its backdrop, with the dialog itself as a child (Modal, the palette), or the dialog itself (the drawer).
  const own = top.matches('[role="dialog"]') ? top : top.querySelector(':scope > [role="dialog"]')
  if (Array.from(top.querySelectorAll(dismissible)).some((el) => el !== own)) return 'popup'
  return own?.matches(dismissible) ? 'layer' : 'hold'
}

/*
 * Android's back button. BLDesk switches views with React state, not browser
 * history, so without this back had nothing to go back to and closed the app
 * from any screen. `onBack` steps back through the app's own navigation and
 * returns false once there is nothing left, at which point the app is sent to
 * the background (like Home), keeping its state, rather than being closed.
 *
 * Desktop and the browser never load @capacitor/app.
 */
export function installAndroidBackButton(onBack: () => boolean): () => void {
  if (Capacitor.getPlatform() !== 'android') return () => {}
  let cancelled = false
  let remove: (() => void) | undefined
  void import('@capacitor/app')
    .then(({ App }) =>
      App.addListener('backButton', () => {
        if (!onBack()) void App.minimizeApp()
      })
    )
    .then((handle) => {
      if (cancelled) void handle.remove()
      else remove = () => void handle.remove()
    })
    .catch((err) => console.warn('[androidBack] back button unavailable:', err))
  return () => {
    cancelled = true
    remove?.()
  }
}
