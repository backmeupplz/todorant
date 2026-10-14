#!/bin/sh
# Builds for the simulator (./build.sh) or archives for the App Store (./build.sh archive)
set -e
cd "$(dirname "$0")"
if [ "$1" = archive ]; then
  xcodebuild -scheme Todorant -destination 'generic/platform=iOS' -archivePath build/Todorant.xcarchive archive 2>&1 | grep -E 'error:|warning:|ARCHIVE' | sort -u
else
  xcodebuild -scheme Todorant -destination 'generic/platform=iOS Simulator' -derivedDataPath build build 2>&1 | grep -E 'error:|warning:|BUILD' | grep -v '^ld:' | sort -u
fi
