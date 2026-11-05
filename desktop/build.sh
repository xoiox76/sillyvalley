#!/bin/zsh
# Baut die Mac-App. Sie merkt sich den Projektordner sowie die Pfade zu node und claude von diesem Rechner.
# Aufruf: desktop/build.sh [Zielordner], ohne Angabe der Schreibtisch.
set -euo pipefail

here=${0:A:h}
project=${here:h}
target=${1:-$HOME/Desktop}
app="$target/Silly Valley.app"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

node_bin=$(command -v node)
claude_bin=$(command -v claude)
tools="${node_bin:h}:${claude_bin:h}:/usr/bin:/bin:/usr/sbin:/sbin"

swiftc -O -swift-version 5 -framework Cocoa -framework WebKit "$here/SillyValley.swift" -o "$work/SillyValley"
python3 "$here/icon.py" "$work/icon.iconset"
iconutil -c icns "$work/icon.iconset" -o "$work/icon.icns"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$work/SillyValley" "$app/Contents/MacOS/SillyValley"
cp "$work/icon.icns" "$app/Contents/Resources/icon.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Silly Valley</string>
  <key>CFBundleDisplayName</key><string>Silly Valley</string>
  <key>CFBundleIdentifier</key><string>com.sillyvalley.game</string>
  <key>CFBundleExecutable</key><string>SillyValley</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>SVProject</key><string>$project</string>
  <key>SVNode</key><string>$node_bin</string>
  <key>SVPath</key><string>$tools</string>
</dict></plist>
PLIST
codesign --force --deep --sign - "$app"
echo "$app"
