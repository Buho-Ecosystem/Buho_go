/**
 * useEmojiPicker: the chat's emoji picker as state.
 *
 *   node --test src/composables/__tests__/useEmojiPicker.spec.js
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from 'vue'
import { EMOJI_DOCK_MIN_WIDTH, hasFinePointer, useEmojiPicker } from '../useEmojiPicker.js'

test('layout: docked from the dock width up, a sheet below, and it follows the window', () => {
  const width = ref(EMOJI_DOCK_MIN_WIDTH)
  const picker = useEmojiPicker({ width })
  assert.equal(picker.docked.value, true)
  width.value = EMOJI_DOCK_MIN_WIDTH - 1
  assert.equal(picker.docked.value, false)
  assert.equal(useEmojiPicker({ width: () => 1440 }).docked.value, true)
  assert.equal(useEmojiPicker({ width: 390 }).docked.value, false)
})

test('open: every opening is a new session; only a reaction remembers a message', () => {
  const picker = useEmojiPicker({ width: 1440 })
  assert.equal(picker.mode.value, null)
  picker.open('react', 'message-1')
  assert.deepEqual([picker.mode.value, picker.reactionId.value, picker.session.value], ['react', 'message-1', 1])
  picker.open('react', 'message-1')
  assert.equal(picker.session.value, 2, 'the same message again still starts fresh')
  picker.open('compose', 'ignored')
  assert.deepEqual([picker.mode.value, picker.reactionId.value, picker.session.value], ['compose', null, 3])
})

test('close: focus goes back to the message reacted to, or to the draft; answered once', () => {
  const picker = useEmojiPicker({ width: 1440 })
  picker.open('react', 'message-1')
  picker.close()
  assert.deepEqual([picker.mode.value, picker.reactionId.value], [null, null])
  assert.deepEqual(picker.takeFocusTarget(), { message: 'message-1' })
  assert.equal(picker.takeFocusTarget(), null)

  picker.open('compose')
  picker.close()
  assert.deepEqual(picker.takeFocusTarget(), { composer: 'button' })
  picker.open('compose')
  picker.close({ composer: 'input' })
  assert.deepEqual(picker.takeFocusTarget(), { composer: 'input' })
})

test('close without returning focus: nothing is handed back, also not from an earlier close', () => {
  const picker = useEmojiPicker({ width: 1440 })
  picker.open('react', 'message-1')
  picker.close({ returnFocus: false })
  assert.equal(picker.mode.value, null)
  assert.equal(picker.takeFocusTarget(), null)

  // Closed, focus still pending (the sheet is animating out), then the chat changes.
  picker.open('react', 'message-2')
  picker.close()
  picker.close({ returnFocus: false })
  assert.equal(picker.takeFocusTarget(), null)

  // Closing what is already closed keeps a pending hand-back.
  picker.open('react', 'message-3')
  picker.close()
  picker.close()
  assert.deepEqual(picker.takeFocusTarget(), { message: 'message-3' })
})

test('hasFinePointer: a mouse or trackpad, never guessed where there is no window', () => {
  const previous = globalThis.window
  try {
    delete globalThis.window
    assert.equal(hasFinePointer(), false)
    const asked = []
    globalThis.window = { matchMedia: (query) => { asked.push(query); return { matches: true } } }
    assert.equal(hasFinePointer(), true)
    assert.deepEqual(asked, ['(hover: hover) and (pointer: fine)'])
    globalThis.window = { matchMedia: () => ({ matches: false }) }
    assert.equal(hasFinePointer(), false)
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
})
