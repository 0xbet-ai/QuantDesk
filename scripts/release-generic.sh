#!/usr/bin/env bash
set -euo pipefail

# Release a new version of the generic engine image.
#
# Usage:
#   pnpm release:generic 0.2.0
#
# What it does:
#   1. Updates the pinned tag in images.ts and package.json
#   2. Commits the change
#   3. Creates a git tag (generic-v<version>)
#   4. Pushes commit + tag to origin
#   5. CI builds multi-arch image and pushes to ghcr.io

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: pnpm release:generic <version>"
  echo "Example: pnpm release:generic 0.2.0"
  exit 1
fi

# Validate semver-ish format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 0.2.0), got '$VERSION'"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGES_FILE="$REPO_ROOT/packages/engines/src/images.ts"
PACKAGE_JSON="$REPO_ROOT/package.json"
TAG="generic-v${VERSION}"

# Check tag doesn't already exist
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

# Check working tree is clean
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

# Extract current version from images.ts
CURRENT="$(grep -oP 'quantdesk-generic:\K[0-9]+\.[0-9]+\.[0-9]+' "$IMAGES_FILE")"
if [[ -z "$CURRENT" ]]; then
  echo "Error: could not find current version in $IMAGES_FILE"
  exit 1
fi

if [[ "$CURRENT" == "$VERSION" ]]; then
  echo "Error: version is already $VERSION"
  exit 1
fi

echo "Releasing generic engine: $CURRENT -> $VERSION"
echo ""

# Update images.ts
sed -i '' "s|quantdesk-generic:${CURRENT}|quantdesk-generic:${VERSION}|g" "$IMAGES_FILE"

# Update package.json build script
sed -i '' "s|quantdesk-generic:${CURRENT}|quantdesk-generic:${VERSION}|g" "$PACKAGE_JSON"

# Commit
git add "$IMAGES_FILE" "$PACKAGE_JSON"
git commit -m "chore(engine): bump generic engine image to ${VERSION}"

# Tag + push
git tag "$TAG"
git push origin main "$TAG"

echo ""
echo "Done. CI will build and push ghcr.io/0xbet-ai/quantdesk-generic:${VERSION}"
echo "Track: gh run list --workflow=docker-generic.yml --limit=1"
