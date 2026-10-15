import { Capacitor } from '@capacitor/core'
import { App } from '@capacitor/app'

/**
 * Calls `handler` on every press of Android's Back button until the
 * returned function is called. Does nothing on other platforms.
 */
export function onAndroidBack(handler) {
  if (Capacitor.getPlatform() !== 'android') return () => {}
  let stopped = false
  let listener = null
  App.addListener('backButton', handler).then((handle) => {
    if (stopped) handle.remove()
    else listener = handle
  })
  return () => {
    stopped = true
    listener?.remove()
  }
}
