#!/usr/bin/env bash
# Publish the viewer (web/ + gzipped data) to the gh-pages branch for GitHub Pages.
# Run pipeline.py first. Usage: ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
REPO_ROOT=$(git rev-parse --show-toplevel)
OUT=$(mktemp -d)

echo "gzipping data..."
for f in web/data/index.json web/data/games/*.json; do
  [ "$f.gz" -nt "$f" ] || gzip -9 -k -f "$f"
done

echo "staging site in $OUT"
cp web/index.html web/*.js "$OUT/"
[ -d web/models ] && cp -r web/models "$OUT/"
mkdir -p "$OUT/data/games"
cp web/data/index.json.gz "$OUT/data/"
cp web/data/games/*.json.gz "$OUT/data/games/"
touch "$OUT/.nojekyll"

cd "$OUT"
git init -q -b gh-pages
git add -A
git commit -q -m "Deploy PocketReplay 3D"
git push -f "$(git -C "$REPO_ROOT" remote get-url origin)" gh-pages:gh-pages
rm -rf "$OUT"
echo "pushed to gh-pages"
