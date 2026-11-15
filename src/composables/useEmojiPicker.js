import { computed, ref, toValue } from 'vue'

/** From this width the picker docks beside the chat; below it, it is a bottom sheet. */
export const EMOJI_DOCK_MIN_WIDTH = 1024

/**
 * A mouse or trackpad. A touch screen types emoji with its own keyboard, so
 * only this kind of pointer gets the composer's emoji button, and only it has
 * the picker's search focused on opening (focus would raise a touch keyboard).
 * components/chat/Composer.vue and MessageBubble.vue use the same query in CSS.
 */
const FINE_POINTER = '(hover: hover) and (pointer: fine)'

export function hasFinePointer() {
  return typeof window !== 'undefined' && window.matchMedia?.(FINE_POINTER).matches === true
}

/**
 * The chat's emoji picker as state: open or not, what for, how it is laid
 * out, and where focus goes once it has left the screen.
 *
 *   mode        null | 'compose' (emoji for the draft) | 'react' (a reaction)
 *   session     counts openings: the picker starts fresh each time
 *   reactionId  the message a reaction is for
 *   docked      beside the chat (true) or a bottom sheet over it (false)
 *
 * `close` is the only way it closes.
 *
 * @param {object} options
 * @param {unknown} options.width Ref, getter or value: the window width in px.
 */
export function useEmojiPicker({ width }) {
  const mode = ref(null)
  const session = ref(0)
  const reactionId = ref(null)
  /** { message: id } | { composer: 'input' | 'button' } | null */
  let focusTarget = null

  const docked = computed(() => Number(toValue(width)) >= EMOJI_DOCK_MIN_WIDTH)

  function open(next, messageId = null) {
    session.value += 1
    reactionId.value = next === 'react' ? messageId : null
    mode.value = next
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.returnFocus=true] False when what the picker belonged to is gone
   *   (another chat, a block): focus must not jump back to it.
   * @param {'input' | 'button'} [options.composer='button'] Where a draft's picker hands focus back.
   */
  function close({ returnFocus = true, composer = 'button' } = {}) {
    if (!returnFocus) focusTarget = null
    else if (mode.value === 'react') focusTarget = { message: reactionId.value }
    else if (mode.value === 'compose') focusTarget = { composer }
    mode.value = null
    reactionId.value = null
  }

  /** Where focus goes now that the picker is off the screen. Answered once. */
  function takeFocusTarget() {
    const target = focusTarget
    focusTarget = null
    return target
  }

  return { mode, session, reactionId, docked, open, close, takeFocusTarget }
}
