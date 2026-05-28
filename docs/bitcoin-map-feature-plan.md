# Bitcoin Map — Feature Adoption Plan (in-app vs web-redirect)

Status: **for discussion** — nothing implemented from this list yet.
Branch: `bitcoin_map`. Source we're comparing against: `pratik227/bitcoinmap`.

---

## 1. The constraint we're designing around

Pratik's project is a **web app**, so it freely sends users to the open web
(`window.open(...)` / `<a href target="_blank">`). BuhoGO is a **Capacitor app
shipped on the App Store / Play Store**, where that pattern is a problem:

- **Apple** (Human Interface Guidelines + Review 4.2 "minimum functionality"):
  bouncing users into Safari for core functionality reads as "this is just a
  website" and is a known rejection/again-UX risk. The blessed way to show web
  content is the **in-app browser** (`SFSafariViewController`), not external
  Safari.
- **Google Play**: more lenient, but the equivalent **Chrome Custom Tab** is
  still the better, "stays in your app" experience.

So the rule of thumb for everything we add:

| Tier | Pattern | Verdict |
|---|---|---|
| ✅ **Best** | Pure in-app (clipboard, our own send flow, our own UI) | Always prefer |
| ✅ **Fine** | Native OS handoffs that are *expected*: Share sheet, Maps app for directions, dialer (`tel:`), Mail | Accepted by both stores |
| ⚠️ **Acceptable** | **In-app browser** (Capacitor `Browser` → Custom Tab / SafariVC) for web we must show | Use this instead of external |
| ❌ **Avoid** | `window.open(webUrl)` / `<a href>` to a website → kicks user to the system browser | Don't ship for core flows |

**Net:** the fix is rarely "drop the feature" — it's "render it in-app, or open
it in the in-app browser instead of the system browser." We'd add
`@capacitor/browser` (one dependency) as the shared mechanism for ⚠️ cases.

---

## 2. The diff recap (what Pratik has that we don't)

From the commit/file audit of his `main`:

1. Lightning Address in popup + copy
2. BTC payment-discount highlighting — **note: backed by a curated static
   `data/discounts.json` with placeholder/fake entries**, not live data
3. Social links (Telegram / Twitter / Mastodon / Instagram / Facebook)
4. Category-specific map pins (Iconify glyphs)
5. "I paid here" / **Verify** location (bumps OSM `check_date`)
6. Heatmap view mode
7. 5 basemap styles (Positron/Bright/Liberty/Dark/Fiord) + 3D pitch
8. Communities layer (meetup polygons + popups)
9. Favorites / starred (localStorage)
10. PWA installable + offline tile/place caching
11. More locales (JA, IT)
12. Landing page at `/`

Where **we're already ahead**: mobile bottom-sheet + distance list, native
directions handoff, freshness chip as a first-class signal, black-forward light
theme, `?place=` deep link, in-map light/dark toggle that themes the whole view.

---

## 3. Feature-by-feature: web-redirect risk + the in-app answer

### A. Lightning Address + copy  →  ✅ pure in-app (and our biggest win)
- **Pratik:** copy to clipboard (already in-app).
- **BuhoGO opportunity:** go further — tapping the Lightning Address opens
  **our own send/pay sheet pre-filled** with that address. The user pays the
  merchant without ever leaving BuhoGO. This is the single most on-brand
  feature for a Lightning wallet and is *100% in-app*.
- **Verdict:** ✅ Build. Copy button + "Pay this merchant" → existing send flow.
- **Data:** OSM tags `payment:lightning:address` / `lightning:address` /
  `payment:lightning:lnurl` / `:nodeid` (re-sync from his `osm.js`).

### B. Favorites / starred  →  ✅ pure in-app
- localStorage (or Capacitor Preferences for native durability). A star on the
  detail + a "Saved" filter in the filter sheet.
- **Verdict:** ✅ Build. No web at all.

### C. Verify / "Still accepting?"  →  ❌ as-is (web redirect)
- **Pratik:** `window.open('https://btcmap.org/verify-location?id=...')` →
  external Safari. **This is exactly the pattern the stores dislike.**
- **In-app options:**
  1. **In-app browser** (`Browser.open`, Custom Tab / SafariVC) to BTC Map's
     verify page — stays "in app," acceptable. Lowest effort.
  2. **Native in-app verify** — call BTC Map's API directly to submit a
     check-in/verify. Needs investigation: their verify likely requires OSM
     auth or a BTC Map account, which we don't have → probably not feasible
     without their auth flow.
  3. **Defer** the feature. Our freshness *chip* (read-only "Verified X ago")
     already delivers the trust signal; user-submitted verification is a
     community-good but not core to "find a shop."
- **Recommendation (discuss):** ship the freshness chip only for now; treat
  user-verify as in-app-browser fast-follow if we add `@capacitor/browser`.

### D. Social / contact links  →  ⚠️ web redirect → use in-app browser
- **Pratik:** `<a href>` to telegram.org/twitter.com/etc → external.
- **In-app answer:** show the icons only when present; open via
  `@capacitor/browser` (Custom Tab / SafariVC). Telegram/Instagram/etc. deep
  links *may* hand off to their native apps if installed (accepted) — otherwise
  the in-app browser catches them.
- **Verdict:** ⚠️ Build with in-app browser. Low clutter (icons only when data
  exists). Low priority vs A/B.

### E. Category-specific map pins  →  ✅ pure in-app
- Rendering only, no web. Plan: keep the **branded orange pin**, draw a white
  **category glyph** (Path2D from a small per-bucket SVG-path map) — scannable,
  consistent, not noisy.
- **Verdict:** ✅ Build.

### F. Website link (already in our detail)  →  ⚠️ currently `<a href target=_blank>`
- We already render a Website action. On native it currently opens the system
  browser. **Switch it to `@capacitor/browser`** (in-app) to satisfy the
  guideline. Small change.
- **Verdict:** ⚠️ Fix existing to use in-app browser.

### G. Directions  →  ✅ native Maps handoff (keep)
- `geo:` intent / Apple Maps / Google Maps universal link → opens the **native
  Maps app**. This is an *expected* native handoff, explicitly fine on both
  stores (countless apps do it; we don't do in-app turn-by-turn).
- **Verdict:** ✅ Keep as-is. Not a "web redirect."

### H. Share  →  ✅ native share sheet (keep)
- `@capacitor/share` → OS share sheet (in-app overlay). Accepted.
- **Verdict:** ✅ Keep.

### I. Discount highlighting  →  ⏸️ skip (no real data)
- His data is a hand-curated `discounts.json` with placeholder IDs. We'd ship an
  empty/fake feature. Skip until there's a real discount data source.

### J–M. Heatmap / 5 basemaps+3D / Communities / extra locales  →  ✅ in-app but deprioritized
- All in-app (no web concern), but flagged for **overload** vs our "lovable,
  not overloaded" goal and low spend-value. Park them.

---

## 4. Proposed build (the "in-app-first" 5) — for discussion

Re-ordered from the earlier pick now that the web-redirect lens is applied:

1. **Lightning Address → copy + "Pay this merchant" (opens our send flow)** — ✅ pure in-app, highest value.
2. **Favorites / starred + "Saved" filter** — ✅ pure in-app.
3. **Category map pins** (branded pin + white glyph) — ✅ pure in-app.
4. **Social/contact links via in-app browser** (`@capacitor/browser`) — ⚠️ contained.
5. **Fix the existing Website action to use the in-app browser** — ⚠️ small, removes an existing external bounce.

Plus the **PlaceDetail section redesign** to hold this cleanly (Ways-to-pay
section with badges + LN address, primary actions, contact/social as compact
icons, favorite star in header, freshness chip).

**Dropped / deferred from the original 5:** "Verify" (web redirect — defer or
in-app-browser later), Discount (fake data).

### New dependency
- `@capacitor/browser` — the in-app browser for ⚠️ cases (social, website,
  and later verify). One small, official Capacitor plugin.

---

## 5. Open questions for us to decide

1. **Lightning Address:** copy-only, or wire "Pay this merchant" into BuhoGO's
   existing send/pay sheet? (Recommend: wire it in — it's the standout.)
2. **Verify:** drop for now, or add `@capacitor/browser` and open BTC Map's
   verify in an in-app browser? (Recommend: drop now, revisit.)
3. **Social links:** worth the `@capacitor/browser` dependency, or skip social
   entirely and keep the detail ultra-clean? (Lean: include, it's contained.)
4. **Directions:** confirmed OK as native Maps handoff? (Recommend: yes, keep.)
5. **Favorites storage:** localStorage (simple) vs `@capacitor/preferences`
   (survives reinstall-less clears, native-durable)? (Recommend: Preferences.)
