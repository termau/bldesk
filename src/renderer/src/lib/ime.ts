/**
 * Whether a key press belongs to an input method's composition (Japanese, Chinese, Korean and so on), where Enter picks
 * a candidate rather than submitting. Every handler that acts on Enter checks this first. keyCode 229 covers browsers
 * that end the composition before the confirming keydown reaches script.
 */
export function isComposing(e: KeyboardEvent | { nativeEvent: KeyboardEvent }): boolean {
  const k = 'nativeEvent' in e ? e.nativeEvent : e
  return k.isComposing || k.keyCode === 229
}
