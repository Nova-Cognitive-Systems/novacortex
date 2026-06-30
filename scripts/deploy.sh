#!/bin/bash
# ============================================
# NovaCortex Deployment Script
# ============================================

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
ENV_FILE="${PROJECT_DIR}/.env"

# Default values
ENVIRONMENT="${ENVIRONMENT:-production}"
PULL_LATEST="${PULL_LATEST:-true}"
RUN_MIGRATIONS="${RUN_MIGRATIONS:-true}"
BACKUP_BEFORE_DEPLOY="${BACKUP_BEFORE_DEPLOY:-true}"

# ============================================
# Helper Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_requirements() {
    log_info "Checking requirements..."

    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed"
        exit 1
    fi

    if ! command -v docker compose &> /dev/null; then
        log_error "Docker Compose is not installed"
        exit 1
    fi

    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env file not found at $ENV_FILE"
        exit 1
    fi

    log_success "All requirements met"
}

validate_env() {
    log_info "Validating environment variables..."

    source "$ENV_FILE"

    REQUIRED_VARS=(
        "DOMAIN"
        "SURREALDB_USER"
        "SURREALDB_PASS"
        "JWT_SECRET"
        "NEXTAUTH_SECRET"
        "REDIS_PASSWORD"
    )

    for var in "${REQUIRED_VARS[@]}"; do
        if [ -z "${!var:-}" ]; then
            log_error "Required environment variable $var is not set"
            exit 1
        fi
    done

    log_success "Environment validated"
}

backup_databases() {
    if [ "$BACKUP_BEFORE_DEPLOY" = "true" ]; then
        log_info "Creating pre-deployment backup..."
        "$SCRIPT_DIR/backup.sh" || {
            log_warning "Backup failed, continuing anyway..."
        }
    fi
}

pull_images() {
    if [ "$PULL_LATEST" = "true" ]; then
        log_info "Pulling latest images..."
        docker compose -f "$COMPOSE_FILE" pull
        log_success "Images pulled"
    fi
}

build_images() {
    log_info "Building application images..."
    docker compose -f "$COMPOSE_FILE" build --no-cache
    log_success "Images built"
}

run_migrations() {
    if [ "$RUN_MIGRATIONS" = "true" ]; then
        log_info "Running database migrations..."
        docker compose -f "$COMPOSE_FILE" run --rm api npm run db:migrate || {
            log_warning "Migrations failed or not configured"
        }
    fi
}

deploy_services() {
    log_info "Deploying services..."

    # Start infrastructure services first
    docker compose -f "$COMPOSE_FILE" up -d surrealdb qdrant redis

    # Wait for databases to be healthy
    log_info "Waiting for databases to be healthy..."
    sleep 10

    # Start application services
    docker compose -f "$COMPOSE_FILE" up -d api web traefik

    log_success "Services deployed"
}

health_check() {
    log_info "Running health checks..."
    "$SCRIPT_DIR/health-check.sh" || {
        log_error "Health checks failed!"
        rollback
        exit 1
    }
    log_success "Health checks passed"
}

rollback() {
    log_warning "Rolling back deployment..."
    docker compose -f "$COMPOSE_FILE" down
    docker compose -f "$COMPOSE_FILE" up -d --force-recreate
}

cleanup() {
    log_info "Cleaning up old images..."
    docker image prune -f --filter "until=24h"
    docker volume prune -f --filter "label!=keep"
    log_success "Cleanup complete"
}

show_status() {
    log_info "Deployment Status:"
    docker compose -f "$COMPOSE_FILE" ps
    echo ""
    log_info "Service URLs:"
    source "$ENV_FILE"
    echo "  Web:      https://${DOMAIN}"
    echo "  API:      https://api.${DOMAIN}"
    echo "  Traefik:  https://traefik.${DOMAIN}"
}

# ============================================
# Main Deployment Flow
# ============================================

main() {
    echo ""
    echo "============================================"
    echo "  NovaCortex Deployment"
    echo "  Environment: $ENVIRONMENT"
    echo "============================================"
    echo ""

    cd "$PROJECT_DIR"

    check_requirements
    validate_env
    backup_databases
    pull_images
    build_images
    run_migrations
    deploy_services
    health_check
    cleanup
    show_status

    echo ""
    log_success "Deployment completed successfully!"
    echo ""
}

# ============================================
# CLI Arguments
# ============================================

case "${1:-deploy}" in
    deploy)
        main
        ;;
    build)
        build_images
        ;;
    up)
        deploy_services
        ;;
    down)
        docker compose -f "$COMPOSE_FILE" down
        ;;
    restart)
        docker compose -f "$COMPOSE_FILE" restart
        ;;
    logs)
        docker compose -f "$COMPOSE_FILE" logs -f "${2:-}"
        ;;
    status)
        show_status
        ;;
    rollback)
        rollback
        ;;
    *)
        echo "Usage: $0 {deploy|build|up|down|restart|logs|status|rollback}"
        exit 1
        ;;
esac
