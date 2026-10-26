#!/usr/bin/env bash
#
# Regenerates the PWA install icons in public/ from public/favicon.svg.
#
#   ./scripts/make-icons.sh
#
# The icons are committed, so this only needs running when the logo changes.
# Chromium does the rasterising because it is already the browser the app is
# verified against — no image toolchain to install, and the PNG is exactly what
# the install prompt will show.
#
# Three sizes, because Android and the desktop install prompt want different
# things: 192 and 512 are shown as-is, while the maskable icon is cropped to
# whatever shape the platform uses (circle, squircle, rounded square). A
# maskable icon must therefore paint to the edges and keep its content inside
# the middle 80% "safe zone", which is why the glyph is drawn smaller there.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

chromium=$(command -v chromium || command -v chromium-browser || command -v google-chrome)

# $1 output name, $2 pixel size, $3 glyph scale (1 = full bleed), $4 corner radius in px
render() {
  local name=$1 size=$2 scale=$3 radius=$4
  cat >"$work/page.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .icon {
    width: ${size}px; height: ${size}px;
    background: #1f2937;
    border-radius: ${radius}px;
    display: flex; align-items: center; justify-content: center;
  }
  svg { width: ${scale}%; height: ${scale}%; }
</style>
<div class="icon">
$(sed 's|<rect width="32" height="32" rx="7" fill="#1F2937"/>||' "$root/public/favicon.svg")
</div>
HTML
  "$chromium" --headless=new --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 \
    --screenshot="$root/public/$name" \
    --window-size="$size,$size" \
    "file://$work/page.html" 2>/dev/null
  echo "  public/$name"
}

echo "Writing icons to $root/public"
render icon-192.png 192 78 42
render icon-512.png 512 78 112
# Full bleed, glyph inside the safe zone.
render icon-maskable-512.png 512 60 0
