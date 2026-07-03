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
BUILD_GRADLE="src-capacitor/android/app/build.gradle"

if [ ! -f "$PACKAGE_JSON" ]; then
    echo "Error: $PACKAGE_JSON not found"
    exit 1
fi

if [ ! -f "$BUILD_GRADLE" ]; then
    echo "Error: $BUILD_GRADLE not found"
    exit 1
fi

CURRENT_VERSION=$(grep -o '"version": "[^"]*"' "$PACKAGE_JSON" | cut -d'"' -f4)
echo "Current version: $CURRENT_VERSION"

sed -i.bak "s/\"version\": \"[^\"]*\"/\"version\": \"$NEW_VERSION\"/" "$PACKAGE_JSON"
echo "✓ Updated $PACKAGE_JSON"

CURRENT_VERSION_CODE=$(grep -o 'versionCode [0-9]*' "$BUILD_GRADLE" | grep -o '[0-9]*')
NEW_VERSION_CODE=$((CURRENT_VERSION_CODE + 1))

sed -i.bak "s/versionCode [0-9]*/versionCode $NEW_VERSION_CODE/" "$BUILD_GRADLE"
sed -i.bak "s/versionName \"[^\"]*\"/versionName \"$NEW_VERSION\"/" "$BUILD_GRADLE"
echo "✓ Updated $BUILD_GRADLE"
echo "  - versionCode: $CURRENT_VERSION_CODE → $NEW_VERSION_CODE"
echo "  - versionName: $NEW_VERSION"

rm -f "$PACKAGE_JSON.bak" "$BUILD_GRADLE.bak"

echo ""
echo "Version update complete!"
echo "New version: $NEW_VERSION (versionCode: $NEW_VERSION_CODE)"
