#!/usr/bin/env bash
set -euo pipefail

# Release a new version of the quantdesk CLI to npm.
#
# Usage:
#   pnpm release:cli 0.2.0
#
# What it does:
#   1. Updates version in cli/package.json
#   2. Commits the change
#   3. Creates a git tag (cli-v<version>)
#   4. Pushes commit + tag to origin
#   5. CI builds and publishes to npm

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: pnpm release:cli <version>"
  echo "Example: pnpm release:cli 0.2.0"
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must be semver (e.g. 0.2.0), got '$VERSION'"
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI_PKG="$REPO_ROOT/cli/package.json"
TAG="cli-v${VERSION}"

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

CURRENT="$(node -p "require('$CLI_PKG').version")"
if [[ "$CURRENT" == "$VERSION" ]]; then
  echo "Error: version is already $VERSION"
  exit 1
fi

echo "Releasing CLI: $CURRENT -> $VERSION"
echo ""

# Update version in cli/package.json
cd "$REPO_ROOT"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('$CLI_PKG', 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync('$CLI_PKG', JSON.stringify(pkg, null, 2) + '\n');
"

git add "$CLI_PKG"
git commit -m "chore(cli): bump CLI version to ${VERSION}"

git tag "$TAG"
git push origin main "$TAG"

echo ""
echo "Done. CI will build and publish quantdesk@${VERSION} to npm."
echo "Track: gh run list --workflow=publish-cli.yml --limit=1"
