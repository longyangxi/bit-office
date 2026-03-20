#!/bin/bash
set -e

# Read productName from tauri.conf.json (no jq dependency)
TAURI_CONF="apps/desktop/src-tauri/tauri.conf.json"
APP_NAME=$(grep '"productName"' "$TAURI_CONF" | sed 's/.*: *"\(.*\)".*/\1/')

if [ -z "$APP_NAME" ]; then
  echo "❌ Could not read productName from $TAURI_CONF"
  exit 1
fi

# Auto-increment patch version (semver: X.Y.Z)
CURRENT_VER=$(grep '"version"' "$TAURI_CONF" | sed 's/.*: *"\(.*\)".*/\1/')
MAJOR=$(echo "$CURRENT_VER" | cut -d. -f1)
MINOR=$(echo "$CURRENT_VER" | cut -d. -f2)
PATCH=$(echo "$CURRENT_VER" | cut -d. -f3)
PATCH=${PATCH:-0}
PATCH=$((PATCH + 1))
NEW_VER="$MAJOR.$MINOR.$PATCH"

# Update version in tauri.conf.json AND root package.json (UI reads from root)
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' "s/\"version\": \"$CURRENT_VER\"/\"version\": \"$NEW_VER\"/" "$TAURI_CONF"
  sed -i '' "s/\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\"/\"version\": \"$NEW_VER\"/" package.json
else
  sed -i "s/\"version\": \"$CURRENT_VER\"/\"version\": \"$NEW_VER\"/" "$TAURI_CONF"
  sed -i "s/\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\"/\"version\": \"$NEW_VER\"/" package.json
fi
echo "📦 Building $APP_NAME v$NEW_VER..."
pnpm --filter bit-office-desktop build

BUNDLE_DIR="apps/desktop/src-tauri/target/release/bundle/macos"
APP_PATH="$BUNDLE_DIR/$APP_NAME.app"

if [ ! -d "$APP_PATH" ]; then
  echo "❌ Build output not found: $APP_PATH"
  exit 1
fi

# Clean up any OTHER .app bundles in /Applications that came from old renames
for old_app in "$BUNDLE_DIR"/*.app; do
  old_name=$(basename "$old_app" .app)
  if [ "$old_name" != "$APP_NAME" ] && [ -d "/Applications/$old_name.app" ]; then
    echo "🧹 Removing old app: /Applications/$old_name.app"
    rm -rf "/Applications/$old_name.app"
  fi
done

# Also check known legacy names
LEGACY_NAMES=("Bit Office")
for legacy in "${LEGACY_NAMES[@]}"; do
  if [ "$legacy" != "$APP_NAME" ] && [ -d "/Applications/$legacy.app" ]; then
    echo "🧹 Removing legacy app: /Applications/$legacy.app"
    rm -rf "/Applications/$legacy.app"
  fi
done

# Install new build
rm -rf "/Applications/$APP_NAME.app"
cp -R "$APP_PATH" /Applications/
echo "✅ Installed to /Applications/$APP_NAME.app"
