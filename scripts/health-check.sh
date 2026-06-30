#!/bin/bash
# ============================================
# NovaCortex Health Check Script
# ============================================

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MAX_RETRIES="${MAX_RETRIES:-5}"
RETRY_INTERVAL="${RETRY_INTERVAL:-5}"

# Load environment
if [ -f "${PROJECT_DIR}/.env" ]; then
    source "${PROJECT_DIR}/.env"
fi

DOMAIN="${DOMAIN:-localhost}"

# ============================================
# Helper Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
}

check_with_retry() {
    local name="$1"
    local check_cmd="$2"
    local retries=0

    while [ $retries -lt $MAX_RETRIES ]; do
        if eval "$check_cmd" 2>/dev/null; then
            log_success "$name"
            return 0
        fi
        retries=$((retries + 1))
        if [ $retries -lt $MAX_RETRIES ]; then
            log_warning "$name - Retry $retries/$MAX_RETRIES"
            sleep $RETRY_INTERVAL
        fi
    done

    log_error "$name"
    return 1
}

# ============================================
# Service Health Checks
# ============================================

check_docker() {
    log_info "Checking Docker services..."

    local services=("novacortex-traefik" "novacortex-api" "novacortex-web" "novacortex-surrealdb" "novacortex-qdrant" "novacortex-redis")
    local all_healthy=true

    for service in "${services[@]}"; do
        local status=$(docker inspect --format='{{.State.Status}}' "$service" 2>/dev/null || echo "not found")
        local health=$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}}' "$service" 2>/dev/null || echo "unknown")

        if [ "$status" = "running" ]; then
            if [ "$health" = "healthy" ] || [ "$health" = "no healthcheck" ]; then
                log_success "$service (status: $status, health: $health)"
            else
                log_warning "$service (status: $status, health: $health)"
            fi
        else
            log_error "$service (status: $status)"
            all_healthy=false
        fi
    done

    $all_healthy
}

check_api() {
    log_info "Checking API service..."

    check_with_retry "API /health" \
        "curl -sf http://localhost:3001/health > /dev/null"
}

check_api_detailed() {
    log_info "Checking API detailed health..."

    local response=$(curl -sf http://localhost:3001/health 2>/dev/null || echo '{}')
    echo "$response" | jq . 2>/dev/null || echo "$response"
}

check_web() {
    log_info "Checking Web service..."

    check_with_retry "Web /api/health" \
        "curl -sf http://localhost:3000/api/health > /dev/null"
}

check_surrealdb() {
    log_info "Checking SurrealDB..."

    check_with_retry "SurrealDB" \
        "docker exec novacortex-surrealdb /surreal isready --conn http://localhost:8000"
}

check_qdrant() {
    log_info "Checking Qdrant..."

    check_with_retry "Qdrant /readyz" \
        "curl -sf http://localhost:6333/readyz > /dev/null"
}

check_qdrant_collections() {
    log_info "Checking Qdrant collections..."

    local response=$(curl -sf http://localhost:6333/collections 2>/dev/null || echo '{}')
    local count=$(echo "$response" | jq '.result.collections | length' 2>/dev/null || echo "0")

    if [ "$count" -gt 0 ]; then
        log_success "Qdrant has $count collection(s)"
        echo "$response" | jq '.result.collections[].name' 2>/dev/null
    else
        log_warning "No Qdrant collections found"
    fi
}

check_redis() {
    log_info "Checking Redis..."

    local password="${REDIS_PASSWORD:-}"
    local auth=""
    if [ -n "$password" ]; then
        auth="-a $password"
    fi

    check_with_retry "Redis PING" \
        "docker exec novacortex-redis redis-cli $auth ping | grep -q PONG"
}

check_traefik() {
    log_info "Checking Traefik..."

    check_with_retry "Traefik" \
        "docker exec novacortex-traefik traefik healthcheck --ping"
}

check_ssl() {
    if [ "$DOMAIN" != "localhost" ]; then
        log_info "Checking SSL certificates..."

        local expiry=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

        if [ -n "$expiry" ]; then
            local expiry_epoch=$(date -d "$expiry" +%s 2>/dev/null || echo 0)
            local now_epoch=$(date +%s)
            local days_left=$(( (expiry_epoch - now_epoch) / 86400 ))

            if [ $days_left -gt 30 ]; then
                log_success "SSL certificate valid for $days_left days"
            elif [ $days_left -gt 0 ]; then
                log_warning "SSL certificate expires in $days_left days"
            else
                log_error "SSL certificate expired!"
            fi
        else
            log_warning "Could not check SSL certificate"
        fi
    fi
}

check_external() {
    if [ "$DOMAIN" != "localhost" ]; then
        log_info "Checking external access..."

        check_with_retry "External Web" \
            "curl -sf https://${DOMAIN}/api/health > /dev/null"

        check_with_retry "External API" \
            "curl -sf https://api.${DOMAIN}/health > /dev/null"
    fi
}

# ============================================
# Resource Checks
# ============================================

check_resources() {
    log_info "Checking resource usage..."

    echo ""
    docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}" | grep novacortex || true
    echo ""
}

check_disk() {
    log_info "Checking disk usage..."

    local usage=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')

    if [ "$usage" -lt 70 ]; then
        log_success "Disk usage: ${usage}%"
    elif [ "$usage" -lt 90 ]; then
        log_warning "Disk usage: ${usage}%"
    else
        log_error "Disk usage critical: ${usage}%"
    fi

    # Docker volumes
    echo ""
    docker system df -v 2>/dev/null | head -20 || true
}

# ============================================
# Full Health Report
# ============================================

full_report() {
    echo ""
    echo "============================================"
    echo "  NovaCortex Health Report"
    echo "  $(date)"
    echo "============================================"
    echo ""

    local exit_code=0

    check_docker || exit_code=1
    echo ""

    check_surrealdb || exit_code=1
    check_qdrant || exit_code=1
    check_qdrant_collections
    check_redis || exit_code=1
    echo ""

    check_api || exit_code=1
    check_api_detailed
    check_web || exit_code=1
    echo ""

    check_traefik || exit_code=1
    check_ssl
    check_external
    echo ""

    check_resources
    check_disk

    echo ""
    echo "============================================"
    if [ $exit_code -eq 0 ]; then
        log_success "All health checks passed"
    else
        log_error "Some health checks failed"
    fi
    echo "============================================"

    return $exit_code
}

# ============================================
# Quick Health Check (for probes)
# ============================================

quick_check() {
    # Just check essential services
    curl -sf http://localhost:3001/health > /dev/null 2>&1 && \
    curl -sf http://localhost:3000/api/health > /dev/null 2>&1
}

# ============================================
# Main
# ============================================

case "${1:-full}" in
    full)
        full_report
        ;;
    quick|probe)
        quick_check
        ;;
    docker)
        check_docker
        ;;
    api)
        check_api && check_api_detailed
        ;;
    web)
        check_web
        ;;
    db|databases)
        check_surrealdb
        check_qdrant
        check_qdrant_collections
        check_redis
        ;;
    resources)
        check_resources
        check_disk
        ;;
    ssl)
        check_ssl
        ;;
    *)
        echo "Usage: $0 {full|quick|docker|api|web|db|resources|ssl}"
        exit 1
        ;;
esac
