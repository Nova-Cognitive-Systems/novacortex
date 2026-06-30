#!/usr/bin/env bash
# ============================================
# NovaCortex - Deploy to Unraid
# ============================================
# Builds Docker images locally, transfers them to Unraid,
# and sets up the compose project.
#
# Usage: ./scripts/deploy-unraid.sh [--build-only] [--transfer-only]
# ============================================

set -euo pipefail

# ── Configuration ──────────────────────────────────
UNRAID_IP="${UNRAID_IP:-192.168.42.20}"
UNRAID_USER="${UNRAID_USER:-root}"
UNRAID_PROJECT_DIR="/boot/config/plugins/compose.manager/projects/novacortex"
IMAGE_TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"

API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3080}"

API_IMAGE="novacortex-api:${IMAGE_TAG}"
WEB_IMAGE="novacortex-web:${IMAGE_TAG}"
ARCHIVE_NAME="novacortex-images.tar"

# ── Colors ─────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# ── Parse flags ────────────────────────────────────
BUILD_ONLY=false
TRANSFER_ONLY=false
for arg in "$@"; do
  case $arg in
    --build-only)    BUILD_ONLY=true ;;
    --transfer-only) TRANSFER_ONLY=true ;;
    --help)
      echo "Usage: $0 [--build-only] [--transfer-only]"
      echo "  --build-only     Build images without transferring"
      echo "  --transfer-only  Transfer existing images without building"
      echo ""
      echo "Environment variables:"
      echo "  UNRAID_IP    Unraid server IP (default: 192.168.42.20)"
      echo "  UNRAID_USER  SSH user (default: root)"
      echo "  IMAGE_TAG    Docker image tag (default: latest)"
      exit 0
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# ── Step 1: Build Images ──────────────────────────
build_images() {
  info "Building Docker images for ${PLATFORM}..."

  info "Building API image..."
  docker build \
    --platform "$PLATFORM" \
    -f packages/api/Dockerfile \
    --target production \
    -t "$API_IMAGE" \
    .

  ok "API image built: $API_IMAGE"

  info "Building Web image..."
  docker build \
    --platform "$PLATFORM" \
    -f packages/web/Dockerfile \
    -t "$WEB_IMAGE" \
    --target production \
    --build-arg "NEXT_PUBLIC_API_URL=http://${UNRAID_IP}:${API_PORT}" \
    --build-arg "NEXT_PUBLIC_WS_URL=ws://${UNRAID_IP}:${API_PORT}" \
    .

  ok "Web image built: $WEB_IMAGE"
}

# ── Step 2: Export Images ─────────────────────────
export_images() {
  info "Exporting images to ${ARCHIVE_NAME}..."
  docker save "$API_IMAGE" "$WEB_IMAGE" -o "$ARCHIVE_NAME"
  local size
  size=$(du -h "$ARCHIVE_NAME" | cut -f1)
  ok "Archive created: ${ARCHIVE_NAME} (${size})"
}

# ── Step 3: Transfer to Unraid ────────────────────
transfer_to_unraid() {
  info "Checking SSH connectivity to ${UNRAID_USER}@${UNRAID_IP}..."
  if ! ssh -o ConnectTimeout=5 "${UNRAID_USER}@${UNRAID_IP}" "echo ok" >/dev/null 2>&1; then
    error "Cannot reach ${UNRAID_USER}@${UNRAID_IP} via SSH. Check connection and SSH key."
  fi
  ok "SSH connection established"

  info "Creating project directory on Unraid..."
  ssh "${UNRAID_USER}@${UNRAID_IP}" "mkdir -p ${UNRAID_PROJECT_DIR}"

  info "Transferring image archive (this may take a few minutes)..."
  scp "$ARCHIVE_NAME" "${UNRAID_USER}@${UNRAID_IP}:/tmp/${ARCHIVE_NAME}"
  ok "Archive transferred"

  info "Loading images on Unraid..."
  ssh "${UNRAID_USER}@${UNRAID_IP}" "docker load -i /tmp/${ARCHIVE_NAME} && rm /tmp/${ARCHIVE_NAME}"
  ok "Images loaded on Unraid"

  info "Transferring docker-compose.yml..."
  scp "templates/unraid/docker-compose.unraid.yml" \
    "${UNRAID_USER}@${UNRAID_IP}:${UNRAID_PROJECT_DIR}/docker-compose.yml"

  # Transfer .env if it doesn't already exist on Unraid
  if ! ssh "${UNRAID_USER}@${UNRAID_IP}" "test -f ${UNRAID_PROJECT_DIR}/.env"; then
    info "Generating .env on Unraid with random secrets..."
    ssh "${UNRAID_USER}@${UNRAID_IP}" "cat > ${UNRAID_PROJECT_DIR}/.env << 'ENVEOF'
# ============================================
# NovaCortex - Unraid Environment
# Generated: $(date -Iseconds)
# ============================================

# Database credentials
SURREALDB_USER=novacortex
SURREALDB_PASS=$(openssl rand -hex 16)

# Security secrets
JWT_SECRET=$(openssl rand -hex 32)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 16)

# Network & Ports
UNRAID_IP=${UNRAID_IP}
API_PORT=${API_PORT}
WEB_PORT=${WEB_PORT}

# Optional: AI provider keys (uncomment and fill in)
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# Optional: License
# LICENSE_KEY=

# Logging
LOG_LEVEL=info
ENVEOF"
    ok ".env created with random secrets"
  else
    warn ".env already exists on Unraid — skipping (delete it to regenerate)"
  fi

  ok "Deployment files transferred to ${UNRAID_PROJECT_DIR}"
}

# ── Step 4: Cleanup local archive ─────────────────
cleanup() {
  if [ -f "$ARCHIVE_NAME" ]; then
    rm "$ARCHIVE_NAME"
    info "Cleaned up local archive"
  fi
}

# ── Main ──────────────────────────────────────────
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║   NovaCortex → Unraid Deployment     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
info "Target: ${UNRAID_USER}@${UNRAID_IP}"
info "Images: ${API_IMAGE}, ${WEB_IMAGE}"
echo ""

if [ "$TRANSFER_ONLY" = false ]; then
  build_images
  export_images
fi

if [ "$BUILD_ONLY" = false ]; then
  transfer_to_unraid
  cleanup
fi

if [ "$BUILD_ONLY" = false ] && [ "$TRANSFER_ONLY" = false ]; then
  echo ""
  echo "  ╔══════════════════════════════════════╗"
  echo "  ║          Deployment Complete          ║"
  echo "  ╚══════════════════════════════════════╝"
  echo ""
  ok "Next steps:"
  echo "  1. Open Unraid Web UI → Docker → Compose Manager"
  echo "  2. Find 'novacortex' project and click 'Compose Up'"
  echo "  3. Wait ~60s for all services to start"
  echo "  4. Access Web UI:  http://${UNRAID_IP}:${WEB_PORT}"
  echo "     Access API:     http://${UNRAID_IP}:${API_PORT}"
  echo ""
  echo "  Or start from terminal:"
  echo "    ssh ${UNRAID_USER}@${UNRAID_IP}"
  echo "    cd ${UNRAID_PROJECT_DIR}"
  echo "    docker compose up -d"
  echo ""
fi
