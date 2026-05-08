import { boot } from 'quasar/wrappers'
import { Dark } from 'quasar'

/**
 * Audit boot file — dev-only, activated by the Playwright harness via
 * `window.__AUDIT__` (set with page.addInitScript before any app code runs).
 *
 * Responsibilities:
 *   1. Force Quasar Dark plugin to the requested theme (light | dark).
 *   2. Expose `window.__audit` with helpers the harness calls via page.evaluate:
 *        - setDark(bool)                 flip theme at runtime
 *        - collectColors(selector)       dump computed colors for audit sidecars
 *        - injectSafeAreaBands(insets)   overlay red bands for safe-area audit
 *
 * This boot is excluded from production builds via quasar.config.js
 * (only registered when ctx.dev).
 */
export default boot(({ app }) => {
  if (typeof window === 'undefined') return
  if (!window.__AUDIT__) return

  const { theme = 'light' } = window.__AUDIT__
  Dark.set(theme === 'dark')

  const setDark = (isDark) => Dark.set(Boolean(isDark))

  const collectColors = (_rootSelector = 'body') => {
    // Query the whole document so Quasar dialog portals (rendered outside the
    // page tree) are included.
    const targets = document.querySelectorAll(
      'button, .q-btn, .q-chip, .q-badge, a, [role="button"], .q-card, .q-item, .q-toolbar, ' +
      '.q-header, .q-footer, .q-page-sticky, .q-tab, .q-fab, .q-fab-action'
    )
    const out = []
    targets.forEach((el) => {
      const cs = getComputedStyle(el)
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: el.className?.toString?.().slice(0, 140) || '',
        role: el.getAttribute('role') || null,
        text: (el.textContent || '').trim().slice(0, 60),
        bg: cs.backgroundColor,
        color: cs.color,
        borderColor: cs.borderColor,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      })
    })
    return out
  }

  const injectSafeAreaBands = ({ top = 0, bottom = 0 } = {}) => {
    const id = '__audit_safe_area_overlay'
    document.getElementById(id)?.remove()
    const style = document.createElement('style')
    style.id = id
    style.textContent = `
      :root { --safe-top: ${top}px; --safe-bottom: ${bottom}px; }
      body.platform-android { --safe-top: ${top}px; --safe-bottom: ${bottom}px; }
      #__audit_band_top, #__audit_band_bottom {
        position: fixed; left: 0; right: 0; z-index: 2147483647;
        background: rgba(255, 40, 40, 0.35);
        pointer-events: none;
        border-top: 1px dashed rgba(255,0,0,0.9);
        border-bottom: 1px dashed rgba(255,0,0,0.9);
        font: 10px/1 monospace; color: white; text-align: right; padding: 2px 4px;
      }
      #__audit_band_top { top: 0; height: ${top}px; }
      #__audit_band_bottom { bottom: 0; height: ${bottom}px; }
    `
    document.head.appendChild(style)
    const top$ = document.createElement('div'); top$.id = '__audit_band_top'; top$.textContent = `top ${top}px`
    const bot$ = document.createElement('div'); bot$.id = '__audit_band_bottom'; bot$.textContent = `bottom ${bottom}px`
    document.body.appendChild(top$)
    document.body.appendChild(bot$)
  }

  const measureOverlaps = ({ top = 0, bottom = 0 } = {}) => {
    const vh = window.innerHeight
    const fixed = Array.from(document.querySelectorAll('*')).filter((el) => {
      const cs = getComputedStyle(el)
      return cs.position === 'fixed' || cs.position === 'sticky'
    })
    const findings = []
    fixed.forEach((el) => {
      if (el.id === '__audit_band_top' || el.id === '__audit_band_bottom') return
      const r = el.getBoundingClientRect()
      if (r.width < 20 || r.height < 12) return
      // Respect padding: a fixed container that holds its content above
      // the safe-area via `padding-bottom: var(--safe-bottom)` should not
      // be flagged. The container's frame reaches the viewport edge by
      // design, but the visible content sits inside the padding-box.
      const cs = getComputedStyle(el)
      const padTop = parseFloat(cs.paddingTop) || 0
      const padBottom = parseFloat(cs.paddingBottom) || 0
      const contentTop = r.top + padTop
      const contentBottom = r.bottom - padBottom
      const overlapTop = contentTop < top ? top - contentTop : 0
      const overlapBottom = contentBottom > vh - bottom ? contentBottom - (vh - bottom) : 0
      if (overlapTop > 0 || overlapBottom > 0) {
        findings.push({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString?.().slice(0, 140) || '',
          id: el.id || null,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          padding: { top: Math.round(padTop), bottom: Math.round(padBottom) },
          overlapTopPx: Math.round(overlapTop),
          overlapBottomPx: Math.round(overlapBottom),
        })
      }
    })
    return findings
  }

  window.__audit = { setDark, collectColors, injectSafeAreaBands, measureOverlaps, app }
})
