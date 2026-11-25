#!/usr/bin/env bash
# Builds dist/github-codeowners-filter-<version>.zip for upload to the Chrome Web Store.
set -euo pipefail
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
mkdir -p dist
out="dist/github-codeowners-filter-${version}.zip"
rm -f "$out"
zip -r -X "$out" manifest.json codeowners.js content.js content.css icons >/dev/null
echo "Built $out"
