#!/bin/sh
# Sign the built app with a stable, self-signed local identity.
#
# Why: macOS authorises every Keychain item against the calling application's
# code signature. An ad-hoc build carries no certificate, so its designated
# requirement is the cdhash — a different value on every rebuild. A Keychain
# "Always Allow" is stored against that requirement, so it can never survive a
# rebuild and the app asks again for each Plaid credential.
#
# A stable self-signed identity keeps the designated requirement identical
# across builds, so one "Always Allow" per item is enough from then on. The
# identity lives only in this Mac's login keychain; nothing is exported and the
# app stays un-notarized and unsuitable for distribution.
#
# Usage:
#   scripts/local-signing.sh                       # create the identity if needed, then sign
#   CARDINAL_SIGN_IDENTITY='My Name' scripts/local-signing.sh
#   scripts/local-signing.sh path/to/Some.app

set -eu

IDENTITY="${CARDINAL_SIGN_IDENTITY:-Cardinal Local}"
BUNDLE_ID="${CARDINAL_BUNDLE_ID:-com.awychoi.cardiganmoney}"
APP="${1:-src-tauri/target/release/bundle/macos/Cardinal.app}"
KEYCHAIN="${HOME}/Library/Keychains/login.keychain-db"

if [ ! -d "$APP" ]; then
  echo "No app bundle at $APP — run 'pnpm tauri:build' first." >&2
  exit 1
fi

if security find-identity -p codesigning 2>/dev/null | grep -qF "\"$IDENTITY\""; then
  echo "Using existing code-signing identity: $IDENTITY"
else
  echo "Creating a self-signed code-signing identity: $IDENTITY"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  pass="$(openssl rand -hex 18)"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout "$tmp/key.pem" -out "$tmp/cert.pem" \
    -subj "/CN=$IDENTITY" \
    -addext "basicConstraints=critical,CA:false" \
    -addext "keyUsage=critical,digitalSignature" \
    -addext "extendedKeyUsage=critical,codeSigning" >/dev/null 2>&1

  # macOS's importer only understands the legacy PKCS#12 algorithms; OpenSSL 3+
  # defaults to AES-256 and SHA-256, which fail with "MAC verification failed".
  # Export with 3DES/SHA-1 first, then fall back to the defaults for older
  # OpenSSL builds that reject those flags.
  if ! openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
      -name "$IDENTITY" -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
      -out "$tmp/identity.p12" -passout "pass:$pass" >/dev/null 2>&1; then
    openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/cert.pem" \
      -name "$IDENTITY" -out "$tmp/identity.p12" -passout "pass:$pass" >/dev/null 2>&1
  fi

  # Trust only /usr/bin/codesign with the private key.
  if ! security import "$tmp/identity.p12" -k "$KEYCHAIN" -P "$pass" -T /usr/bin/codesign >/dev/null; then
    echo "Could not import the identity into $KEYCHAIN." >&2
    echo "Run this script from Terminal (a sandboxed shell cannot write to the keychain)." >&2
    exit 1
  fi
  echo "Imported into the login keychain. It never leaves this Mac."
fi

# A fixed --identifier keeps the designated requirement stable even if the
# bundler would otherwise derive one from the binary name.
codesign --force --deep --identifier "$BUNDLE_ID" --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"

echo
echo "Designated requirement (must stay the same across builds):"
codesign -d -r- "$APP" 2>&1 | tail -1
echo "SHA-256:"
shasum -a 256 "$APP/Contents/MacOS/cardinal"
