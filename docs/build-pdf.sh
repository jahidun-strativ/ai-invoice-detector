#!/bin/bash
# Render the documentation HTML to PDF.
#
# There is no pandoc or wkhtmltopdf on the build machine, so Chrome's headless
# print is the renderer — it is the same engine the HTML was styled against, so
# what the browser shows is what the PDF gets.
#
# Usage:  ./docs/build-pdf.sh
set -euo pipefail

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"

[ -x "$CHROME" ] || { echo "Google Chrome not found at $CHROME"; exit 1; }

for name in developer-guide system-documentation; do
  "$CHROME" --headless --disable-gpu --no-pdf-header-footer \
    --print-to-pdf="$DIR/$name.pdf" \
    "file://$DIR/$name.html" 2>/dev/null
  echo "$name.pdf  $(du -h "$DIR/$name.pdf" | cut -f1)"
done
