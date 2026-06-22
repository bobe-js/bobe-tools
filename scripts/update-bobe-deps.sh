#!/usr/bin/env sh
set -eu

VERSION="${1:-}"
FILTER="${PNPM_FILTER:-./packages/**}"

if [ -z "$VERSION" ]; then
  echo "Usage: pnpm update:bobe <version>"
  echo "Example: pnpm update:bobe 0.0.74"
  echo "Optional: PNPM_FILTER='./packages/**' pnpm update:bobe 0.0.74"
  exit 1
fi

case "$VERSION" in
  @*|latest|next|beta|alpha|canary|workspace:*|link:*|file:*|catalog:*)
    SPEC="$VERSION"
    ;;
  *)
    SPEC="^$VERSION"
    ;;
esac

pnpm up -w \
  "bobe@$SPEC" \
  "bobe-dom@$SPEC" \
  "bobe-shared@$SPEC" \
  "aoye@$SPEC"

pnpm up -r --filter "$FILTER" \
  "bobe@$SPEC" \
  "bobe-dom@$SPEC" \
  "bobe-shared@$SPEC" \
  "aoye@$SPEC"
