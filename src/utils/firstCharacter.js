/**
 * Avatar initials need whole characters: `name.charAt(0)` cuts an emoji in
 * half and shows a broken glyph.
 */

const graphemes = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

/**
 * The first character of a text as a person sees it: a flag, a skin-toned
 * or family emoji, a letter with its accent. Code points are the fallback
 * where the platform has no segmenter.
 */
export function firstCharacter(text) {
  const value = String(text || '').trim()
  if (!value) return ''
  if (graphemes) {
    for (const { segment } of graphemes.segment(value)) return segment
  }
  return [...value][0]
}
