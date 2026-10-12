#!/bin/sh
# Render the release card for a version.
#
#   scripts/release-card/render.sh <version> "<feature>|<feature>|<feature>" "<shot>|<shot>|<shot>" ["<chip title>|<chip subtitle>"]
#
# Features are the release's top Highlights, two to four words each.
# Shots are portrait app screenshots (PNG/WebP), paths relative to the repo
# root or absolute: back-left, back-right, front. The front one is the
# release's lead feature.
#
# Writes Release_Notes/RELEASE_CARD_v<version>.jpg, next to the notes.
set -e
cd "$(dirname "$0")/../.."
[ $# -ge 3 ] || { sed -n '2,11p' "$0"; exit 1; }
VERSION="$1"; FEATURES="$2"; SHOTS="$3"; CHIP="${4:-}"
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

# Absolute paths for the screenshots, and fail early on a missing one.
ABS_SHOTS=$(printf '%s\n' "$SHOTS" | tr '|' '\n' | while IFS= read -r p; do
  [ -z "$p" ] && continue
  if [ "${p#/}" != "$p" ]; then a="$p"; else a="$PWD/$p"; fi
  [ -f "$a" ] || { echo "missing screenshot: $p" >&2; exit 1; }
  printf '%s|' "$a"
done)
QUERY=$(node -e 'const [v,f,s,c]=process.argv.slice(1);console.log(new URLSearchParams({v,f,s:s.replace(/\|$/,""),c}).toString())' "$VERSION" "$FEATURES" "$ABS_SHOTS" "$CHIP")

OUT="Release_Notes/RELEASE_CARD_v$VERSION.jpg"
mkdir -p Release_Notes
TMP="$(mktemp -d)"
# headless Chrome occasionally stalls on the web font; give it 30s, then retry once
for attempt in 1 2; do
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --user-data-dir="$TMP/profile" \
    --virtual-time-budget=5000 --window-size=1200,630 --force-device-scale-factor=1 \
    --screenshot="$TMP/card.png" "file://$PWD/scripts/release-card/card.html?$QUERY" >/dev/null 2>&1 &
  pid=$!; t=0
  while kill -0 $pid 2>/dev/null && [ ! -s "$TMP/card.png" ] && [ $t -lt 30 ]; do sleep 1; t=$((t + 1)); done; sleep 1
  kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true
  [ -s "$TMP/card.png" ] && break
done
[ -s "$TMP/card.png" ] || { echo "render failed" >&2; rm -rf "$TMP"; exit 1; }
# JPEG under ~300 KB: WhatsApp drops larger preview images.
sips -s format jpeg -s formatOptions 84 "$TMP/card.png" --out "$OUT" >/dev/null
rm -rf "$TMP"
echo "$OUT ($(($(stat -f%z "$OUT") / 1024)) KB)"
