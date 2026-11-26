#!/usr/bin/env bash
# Downloads the release and development IPAs of the latest successful main build into one folder,
# replacing the previous pair: ~/Downloads/sonalis-ios/current/{Sonalis.ipa,Sonalis-dev.ipa}.
# Usage: scripts/fetch-builds.sh [run-id]
set -euo pipefail
REPO=giulio177/sonalis-ios
DEST="${SONALIS_BUILDS:-$HOME/Downloads/sonalis-ios/current}"
RUN="${1:-$(gh run list --repo "$REPO" --workflow ios.yml --branch main --event push --status success --limit 1 --json databaseId -q '.[0].databaseId')}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN" --repo "$REPO" --dir "$TMP"
[ -n "$(find "$TMP" -name Sonalis.ipa)" ] && [ -n "$(find "$TMP" -name Sonalis-dev.ipa)" ] || { echo "run $RUN lacks one of the two IPAs" >&2; exit 1; }
mkdir -p "$DEST"
find "$TMP" -name '*.ipa' -exec cp {} "$DEST/" \;
gh run view "$RUN" --repo "$REPO" --json headSha,number -q '"commit \(.headSha[0:7]), build \(.number)"' > "$DEST/BUILD.txt"
cat "$DEST/BUILD.txt"
ls -lh "$DEST"
