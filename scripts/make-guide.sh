#!/usr/bin/env bash
#
# Rebuilds docs/getting-started.odt from docs/getting-started.html.
#
#   ./scripts/make-guide.sh
#
# The guide is authored as HTML and converted, rather than edited as an ODT,
# so that it reviews as a diff like everything else in the repository. Both
# files are committed: the ODT is the one that gets circulated, and not everyone
# who needs to read it has a checkout to build it from.
#
# Requires LibreOffice (`soffice`), which is also what the ODT export is
# verified against.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
profile="$(mktemp -d)"
trap 'rm -rf "$profile"' EXIT

if ! command -v soffice >/dev/null; then
  echo "LibreOffice is not installed: soffice is not on the PATH." >&2
  exit 1
fi

# A throwaway profile, because soffice refuses to run headless while a normal
# LibreOffice window is open on the same one.
soffice \
  -env:UserInstallation="file://$profile" \
  --headless --convert-to odt \
  --outdir "$root/docs" \
  "$root/docs/getting-started.html" >/dev/null

echo "  docs/getting-started.odt"
