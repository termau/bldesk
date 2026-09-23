import { Capacitor } from '@capacitor/core'

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
