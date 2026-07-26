#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: ./update-version.sh <version>"
    echo "Example: ./update-version.sh 1.2.0"
    exit 1
fi

NEW_VERSION=$1

if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: Version must be in format X.Y.Z (e.g., 1.2.0)"
    exit 1
fi

echo "Updating version to $NEW_VERSION..."

PACKAGE_JSON="package.json"
CAPACITOR_PACKAGE_JSON="src-capacitor/package.json"
BUILD_GRADLE="src-capacitor/android/app/build.gradle"
IOS_PROJECT="src-capacitor/ios/App/App.xcodeproj/project.pbxproj"
ZAPSTORE_YAML="zapstore.yaml"

# Underscored form for the APK filename Zapstore points at (1.9.0 -> 1_9_0)
UNDERSCORE_VERSION="${NEW_VERSION//./_}"

for required in "$PACKAGE_JSON" "$CAPACITOR_PACKAGE_JSON" "$BUILD_GRADLE"; do
    if [ ! -f "$required" ]; then
        echo "Error: $required not found"
        exit 1
    fi
done

CURRENT_VERSION=$(grep -o '"version": "[^"]*"' "$PACKAGE_JSON" | cut -d'"' -f4)
echo "Current version: $CURRENT_VERSION"

sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
echo "✓ Updated $PACKAGE_JSON"

sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$CAPACITOR_PACKAGE_JSON"
echo "✓ Updated $CAPACITOR_PACKAGE_JSON"

CURRENT_VERSION_CODE=$(grep -o 'versionCode [0-9]*' "$BUILD_GRADLE" | grep -o '[0-9]*')
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))

sed -i.bak "s/versionCode [0-9]*/versionCode $NEW_VERSION_CODE/" "$BUILD_GRADLE"
sed -i.bak "s/versionName \"[^\"]*\"/versionName \"$NEW_VERSION\"/" "$BUILD_GRADLE"
echo "✓ Updated $BUILD_GRADLE"
echo "  - versionCode: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE"
echo "  - versionName: $NEW_VERSION"

# iOS carries the same pair under different names. Kept level with the
# Android versionCode so a build number means the same thing on both.
if [ -f "$IOS_PROJECT" ]; then
    sed -i.bak "s/MARKETING_VERSION = [^;]*;/MARKETING_VERSION = $NEW_VERSION;/" "$IOS_PROJECT"
    sed -i.bak "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $NEW_VERSION_CODE;/" "$IOS_PROJECT"
    rm -f "$IOS_PROJECT.bak"
    echo "✓ Updated $IOS_PROJECT"
    echo "  - MARKETING_VERSION: $NEW_VERSION"
    echo "  - CURRENT_PROJECT_VERSION: $NEW_VERSION_CODE"
else
    echo "- Skipped iOS project (not present)"
fi

# Zapstore reads the id and version out of the APK, so only the filename
# it points at (and the note documenting it) need bumping here.
if [ -f "$ZAPSTORE_YAML" ]; then
    sed -i.bak "s/version ([0-9][0-9.]*)/version ($NEW_VERSION)/" "$ZAPSTORE_YAML"
    sed -i.bak "s|release_source: ./output/BuhoGO_v[0-9_]*\.apk|release_source: ./output/BuhoGO_v$UNDERSCORE_VERSION.apk|" "$ZAPSTORE_YAML"
    rm -f "$ZAPSTORE_YAML.bak"
    echo "✓ Updated $ZAPSTORE_YAML"
    echo "  - release_source: ./output/BuhoGO_v$UNDERSCORE_VERSION.apk"
else
    echo "- Skipped $ZAPSTORE_YAML (not present)"
fi

rm -f "$PACKAGE_JSON.bak" "$CAPACITOR_PACKAGE_JSON.bak" "$BUILD_GRADLE.bak"

echo ""
echo "Version update complete!"
echo "New version: $NEW_VERSION (versionCode: $NEW_VERSION_CODE)"
echo "Remember: the APK at ./output/BuhoGO_v$UNDERSCORE_VERSION.apk must exist before publishing to Zapstore."
