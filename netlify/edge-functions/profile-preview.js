/**
 * Link previews for shared cards.
 *
 * A shared card link lands in a chat, and what the recipient sees before they
 * tap is a preview card built from the page's meta tags. BuhoGO is a single
 * page app that routes on the hash, so every URL is served the same
 * index.html and would otherwise get the site-wide preview. Someone sharing
 * their card would appear in the chat as the wallet's own advert, which tells
 * the recipient nothing about who sent it.
 *
 * The patterns below string-replace the tags in index.html, so the two files
 * move together: a renamed or reshaped tag there needs its entry updated
 * here, and a tag without an entry keeps its site-wide value on /p/ pages.
 *
 * The build minifies index.html and DROPS attribute quotes
 * (`<meta property=og:image content=...>`), so every pattern tolerates both
 * the quoted source form and the unquoted built form. A pattern written for
 * quotes only matches nothing in production and fails silently.
 *
 * This runs at the edge for /p/* only, takes the name straight out of the URL,
 * and rewrites the handful of tags a preview reads. No lookup is involved: the
 * username is already in the path, which keeps this fast and keeps it working
 * even when the name's own domain is unreachable.
 *
 * Everything else about the response is passed through untouched, so a failure
 * here degrades to the default preview rather than to a broken page.
 */

const OG_IMAGE = '/og/profile-card.jpg';

/** Keys look like keys, not names, so they get the generic wording. */
function isKey(value) {
  return /^(npub1|nprofile1)/i.test(value);
}

/**
 * Escape for an HTML attribute. The value comes from the URL, so it is
 * attacker-controlled and gets treated that way even though it only ever
 * lands inside a meta tag.
 */
function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Pattern for one meta tag, tolerant of the minifier.
 *
 * `attr` is `name` or `property`; `key` the tag it identifies. The trailing
 * whitespace requirement is what keeps `og:image` from also matching
 * `og:image:width` in the unquoted form.
 */
function metaPattern(attr, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`<meta ${attr}=["']?${escaped}["']?\\s[^>]*>`, 'i');
}

/** A fresh, well-formed tag to take its place. */
function metaTag(attr, key, value) {
  return `<meta ${attr}="${key}" content="${escapeAttr(value)}"/>`;
}

/** `/p/maria` -> `@maria`, `/p/npub1…` -> null. */
function displayFromPath(pathname) {
  const raw = pathname.replace(/^\/p\//, '').split('/')[0];
  if (!raw) return null;

  let slug;
  try {
    slug = decodeURIComponent(raw);
  } catch {
    slug = raw;
  }

  if (!slug || isKey(slug)) return null;

  // A full NIP-05 address shortens to its local part, the same way the app
  // shows it. Length is capped so a long slug cannot blow up the preview.
  const local = slug.split('@')[0].slice(0, 40);
  return local ? `@${local}` : null;
}

export default async function profilePreview(request, context) {
  const response = await context.next();

  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  try {
    const url = new URL(request.url);

    // netlify.toml scopes this function to /p/* already; this guard keeps the
    // behaviour true even if that scoping ever drifts, so no other page can
    // acquire a person-shaped preview by configuration accident.
    if (!url.pathname.startsWith('/p/')) return response;

    const who = displayFromPath(url.pathname);

    const title = who ? `${who} on BuhoGO` : 'A BuhoGO card';
    const description = who
      ? `Send Bitcoin to ${who}, or save them as a contact. No account needed.`
      : 'Send Bitcoin, or save this person as a contact. No account needed.';
    const imageAlt = who ? `${who}'s BuhoGO card` : 'A BuhoGO card';
    const image = `${url.origin}${OG_IMAGE}`;
    const canonical = `${url.origin}${url.pathname}`;

    const html = await response.text();

    // Replace the site-wide tags rather than appending: a duplicate og:title
    // is resolved differently by every scraper, and the first one usually wins.
    const tags = [
      ['name', 'title', title],
      ['name', 'description', description],
      ['property', 'og:url', canonical],
      ['property', 'og:title', title],
      ['property', 'og:description', description],
      ['property', 'og:image', image],
      ['property', 'og:image:alt', imageAlt],
      ['property', 'twitter:url', canonical],
      ['property', 'twitter:title', title],
      ['property', 'twitter:description', description],
      ['property', 'twitter:image', image],
    ];

    let patched = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttr(title)}</title>`);
    for (const [attr, key, value] of tags) {
      patched = patched.replace(metaPattern(attr, key), metaTag(attr, key, value));
    }

    return new Response(patched, {
      status: response.status,
      headers: response.headers,
    });
  } catch (err) {
    console.error('[profile-preview] falling through to the default page', err);
    return response;
  }
}
