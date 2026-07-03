#!/usr/bin/env bash
# ============================================================
# Companion deploy — build the PWA and ship to Hostinger.
#
#   ./deploy.sh          build → both (companion + devcompanion)
#   ./deploy.sh live     build → companion.myappbuddy.com.au only
#   ./deploy.sh dev      build → devcompanion.myappbuddy.com.au only
#   ./deploy.sh --no-build   skip npm build
# ============================================================
set -euo pipefail

ENV="${1:-both}"
NO_BUILD="${2:-}"
if [ "$ENV" = "--no-build" ]; then NO_BUILD="--no-build"; ENV="both"; fi

SSH_HOST="153.92.11.14"
SSH_PORT="65002"
SSH_USER="u404781907"
SSH_KEY="${HOME}/.ssh/hostinger_myappbuddy"

SSH="ssh -p ${SSH_PORT} -i ${SSH_KEY} -o BatchMode=yes"
SCP="scp -P ${SSH_PORT} -i ${SSH_KEY} -o BatchMode=yes -q"

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [ "$NO_BUILD" != "--no-build" ]; then
  echo "==> Building…"
  npm run build
fi

BUNDLE="$(mktemp -u).tgz"
trap 'rm -f "$BUNDLE"' EXIT
tar czf "$BUNDLE" -C dist .

deploy_to() {
  local DOCROOT="$1"
  local URL="$2"
  echo "==> Uploading to ${URL}…"
  local TAG="${DOCROOT##*/}"
  $SCP "$BUNDLE" "${SSH_USER}@${SSH_HOST}:/tmp/companion_${TAG}.tgz"
  $SSH "${SSH_USER}@${SSH_HOST}" bash -s <<REMOTE
set -e
cd ~/${DOCROOT} 2>/dev/null || { echo "!! ${DOCROOT} does not exist"; exit 2; }
rm -rf assets
tar xzf /tmp/companion_${TAG}.tgz
rm -f /tmp/companion_${TAG}.tgz
echo "  deployed to ${DOCROOT}"
REMOTE
  curl -fsS -m 15 "${URL}/" > /dev/null && echo "  smoke test OK" || echo "  (smoke test failed — check DNS)"
}

case "$ENV" in
  live)
    deploy_to "domains/myappbuddy.com.au/public_html/companion"     "https://companion.myappbuddy.com.au"
    ;;
  dev)
    deploy_to "domains/myappbuddy.com.au/public_html/devcompanion"  "https://devcompanion.myappbuddy.com.au"
    ;;
  both)
    deploy_to "domains/myappbuddy.com.au/public_html/companion"     "https://companion.myappbuddy.com.au"
    deploy_to "domains/myappbuddy.com.au/public_html/devcompanion"  "https://devcompanion.myappbuddy.com.au"
    ;;
  *)
    echo "Usage: $0 [{live|dev|both}] [--no-build]"; exit 1 ;;
esac

echo "==> Done"
