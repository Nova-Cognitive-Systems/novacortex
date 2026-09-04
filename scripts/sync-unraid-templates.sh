#!/usr/bin/env bash
# ============================================
# NovaCortex — sync the Unraid distribution artifacts
# ============================================
# The root docker-compose.unraid.yml is the source of truth. Unraid users are
# pointed at templates/unraid/, so an identical copy lives there; this script
# keeps it identical and keeps the image tag pinned in the Community Apps
# templates equal to the version the compose file pins.
#
# Usage:
#   ./scripts/sync-unraid-templates.sh            # write the copy / report drift
#   ./scripts/sync-unraid-templates.sh --check    # fail on drift, change nothing (CI)
# ============================================

set -euo pipefail

CHECK_ONLY=false
[ "${1:-}" = "--check" ] && CHECK_ONLY=true

cd "$(cd "$(dirname "$0")/.." && pwd)"

SRC="docker-compose.unraid.yml"
DST="templates/unraid/docker-compose.unraid.yml"
TEMPLATES=(templates/unraid/novacortex-api.xml templates/unraid/novacortex-web.xml)
# Community Apps templates for the backing services, and the compose service each one mirrors.
declare -A BACKING=(
  [templates/unraid/novacortex-surrealdb.xml]=surrealdb
  [templates/unraid/novacortex-qdrant.xml]=qdrant
  [templates/unraid/novacortex-redis.xml]=redis
)

fail=0
note() { echo "  $*"; }

# ── The templates/unraid/ copy must be byte-identical to the root file ──
if cmp -s "$SRC" "$DST"; then
  note "OK   $DST matches $SRC"
elif [ "$CHECK_ONLY" = true ]; then
  echo "DRIFT $DST differs from $SRC — run scripts/sync-unraid-templates.sh" >&2
  diff -u "$SRC" "$DST" >&2 || true
  fail=1
else
  cp "$SRC" "$DST"
  note "SYNC $DST <- $SRC"
fi

# ── The CA templates must pin the version the compose file defaults to ──
VERSION=$(sed -n 's/.*novacortex-api:\${NOVACORTEX_VERSION:-\([0-9][^}]*\)}.*/\1/p' "$SRC" | head -1)
if [ -z "$VERSION" ]; then
  echo "DRIFT could not read the pinned NOVACORTEX_VERSION out of $SRC" >&2
  fail=1
else
  for t in "${TEMPLATES[@]}"; do
    want="novacortex-${t##*novacortex-}"; want="${want%.xml}:${VERSION}"
    if grep -q "<Repository>ghcr.io/nova-cognitive-systems/${want}</Repository>" "$t"; then
      note "OK   $t pins $want"
    else
      echo "DRIFT $t does not pin ghcr.io/nova-cognitive-systems/${want}" >&2
      note "     found: $(grep -o '<Repository>[^<]*</Repository>' "$t")"
      fail=1
    fi
  done
fi

# ── The backing-service templates must pin the upstream images compose uses ──
for t in "${!BACKING[@]}"; do
  svc="${BACKING[$t]}"
  # The image line of that service in the compose file, e.g. "surrealdb/surrealdb:v2.2".
  image=$(awk -v s="  ${svc}:" '$0==s{f=1;next} f&&/^  [a-z]/{exit} f&&/^ *image:/{print $2;exit}' "$SRC")
  if [ -z "$image" ]; then
    echo "DRIFT could not read the image for service '${svc}' out of $SRC" >&2
    fail=1
  elif grep -q "<Repository>${image}</Repository>" "$t"; then
    note "OK   $t pins $image"
  else
    echo "DRIFT $t does not pin ${image} (the tag $SRC uses for '${svc}')" >&2
    note "     found: $(grep -o '<Repository>[^<]*</Repository>' "$t")"
    fail=1
  fi
done

# ── gen-env.sh writes NOVACORTEX_VERSION into every generated .env ──
if [ -n "${VERSION:-}" ] && ! grep -q "^NOVACORTEX_VERSION=${VERSION}$" scripts/gen-env.sh; then
  echo "DRIFT scripts/gen-env.sh does not write NOVACORTEX_VERSION=${VERSION}" >&2
  note "     found: $(grep -o '^NOVACORTEX_VERSION=.*' scripts/gen-env.sh)"
  fail=1
elif [ -n "${VERSION:-}" ]; then
  note "OK   scripts/gen-env.sh writes NOVACORTEX_VERSION=${VERSION}"
fi

if [ "$fail" -ne 0 ]; then
  echo "" >&2
  echo "Unraid artifacts are out of sync. Fix the versions above (release bump:" >&2
  echo "docker-compose{,.unraid}.yml, scripts/gen-env.sh, templates/unraid/*.xml)." >&2
  exit 1
fi

echo "Unraid artifacts are in sync (NovaCortex ${VERSION})."
