#!/usr/bin/env bash
# ============================================================
# Companion deploy — build the PWA and ship to Hostinger.
#
#   ./deploy.sh live    build → companion.myappbuddy.com.au
#   ./deploy.sh dev     build → devcompanion.myappbuddy.com.au
#   ./deploy.sh live --no-build   skip npm build
# ============================================================
set -euo pipefail

ENV="${1:-}"
NO_BUILD="${2:-}"

SSH_HOST="153.92.11.14"
SSH_PORT="65002"
SSH_USER="u404781907"
SSH_KEY="${HOME}/.ssh/hostinger_myappbuddy"

case "$ENV" in
  live)
    DOCROOT="domains/myappbuddy.com.au/public_html/companion"
    URL="https://companion.myappbuddy.com.au"
    ;;
  dev)
    DOCROOT="domains/myappbuddy.com.au/public_html/devcompanion"
    URL="https://devcompanion.myappbuddy.com.au"
    ;;
  *)
    echo "Usage: $0 {live|dev} [--no-build]"; exit 1 ;;
esac

SSH="ssh -p ${SSH_PORT} -i ${SSH_KEY} -o BatchMode=yes"
SCP="scp -P ${SSH_PORT} -i ${SSH_KEY} -o BatchMode=yes -q"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "==> Deploying Companion to ${ENV} (${URL})"

if [ "$NO_BUILD" != "--no-build" ]; then
  echo "==> Building…"
  npm run build
fi

STAGE="$(mktemp -d)"
BUNDLE="$(mktemp -u).tgz"
trap 'rm -rf "$STAGE" "$BUNDLE"' EXIT

cp -r dist/. "$STAGE"/

tar czf "$BUNDLE" -C "$STAGE" .
echo "==> Uploading…"
$SCP "$BUNDLE" "${SSH_USER}@${SSH_HOST}:/tmp/companion_${ENV}.tgz"

echo "==> Extracting on server…"
$SSH "${SSH_USER}@${SSH_HOST}" bash -s <<REMOTE
set -e
cd ~/${DOCROOT} 2>/dev/null || { echo "!! ${DOCROOT} does not exist"; exit 2; }
rm -rf assets
tar xzf /tmp/companion_${ENV}.tgz
rm -f /tmp/companion_${ENV}.tgz
echo "deployed to ${DOCROOT}"
REMOTE

echo "==> Smoke test…"
curl -fsS -m 15 "${URL}/" > /dev/null && echo "OK" || echo "(smoke test failed — check DNS)"
echo "==> Done: ${ENV}"
