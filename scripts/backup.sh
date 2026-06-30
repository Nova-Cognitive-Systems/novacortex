#!/bin/bash
# ============================================
# NovaCortex Database Backup Script
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
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Load environment
source "${PROJECT_DIR}/.env"

# ============================================
# Helper Functions
# ============================================

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

create_backup_dir() {
    mkdir -p "$BACKUP_DIR"/{surrealdb,qdrant,redis}
}

# ============================================
# SurrealDB Backup
# ============================================

backup_surrealdb() {
    log_info "Backing up SurrealDB..."

    local backup_file="${BACKUP_DIR}/surrealdb/surrealdb_${TIMESTAMP}.surql"

    docker exec novacortex-surrealdb /surreal export \
        --conn http://localhost:8000 \
        --user "${SURREALDB_USER}" \
        --pass "${SURREALDB_PASS}" \
        --ns "${SURREALDB_NAMESPACE:-novacortex}" \
        --db "${SURREALDB_DATABASE:-production}" \
        > "$backup_file" 2>/dev/null || {
            # Alternative: copy volume data
            docker run --rm \
                -v novacortex_surrealdb-data:/data:ro \
                -v "${BACKUP_DIR}/surrealdb:/backup" \
                alpine tar czf "/backup/surrealdb_${TIMESTAMP}.tar.gz" -C /data .
        }

    log_success "SurrealDB backup: $backup_file"
}

# ============================================
# Qdrant Backup
# ============================================

backup_qdrant() {
    log_info "Backing up Qdrant..."

    local backup_file="${BACKUP_DIR}/qdrant/qdrant_${TIMESTAMP}.tar.gz"

    # Create snapshot via API
    curl -s -X POST "http://localhost:6333/snapshots" \
        -H "api-key: ${QDRANT_API_KEY:-}" \
        > /dev/null 2>&1 || true

    # Copy volume data
    docker run --rm \
        -v novacortex_qdrant-data:/data:ro \
        -v "${BACKUP_DIR}/qdrant:/backup" \
        alpine tar czf "/backup/qdrant_${TIMESTAMP}.tar.gz" -C /data .

    log_success "Qdrant backup: $backup_file"
}

# ============================================
# Redis Backup
# ============================================

backup_redis() {
    log_info "Backing up Redis..."

    local backup_file="${BACKUP_DIR}/redis/redis_${TIMESTAMP}.rdb"

    # Trigger BGSAVE
    docker exec novacortex-redis redis-cli \
        -a "${REDIS_PASSWORD}" BGSAVE 2>/dev/null

    sleep 2

    # Copy RDB file
    docker cp novacortex-redis:/data/dump.rdb "$backup_file" 2>/dev/null || {
        # Alternative: copy volume data
        docker run --rm \
            -v novacortex_redis-data:/data:ro \
            -v "${BACKUP_DIR}/redis:/backup" \
            alpine cp /data/dump.rdb "/backup/redis_${TIMESTAMP}.rdb" 2>/dev/null || true
    }

    log_success "Redis backup: $backup_file"
}

# ============================================
# Cleanup Old Backups
# ============================================

cleanup_old_backups() {
    log_info "Cleaning up backups older than ${RETENTION_DAYS} days..."

    find "$BACKUP_DIR" -type f -mtime +${RETENTION_DAYS} -delete

    log_success "Old backups cleaned"
}

# ============================================
# Upload to Remote Storage (Optional)
# ============================================

upload_to_s3() {
    if [ -n "${S3_BUCKET:-}" ]; then
        log_info "Uploading to S3..."

        aws s3 sync "$BACKUP_DIR" "s3://${S3_BUCKET}/novacortex/backups/${TIMESTAMP}/" \
            --exclude "*" \
            --include "*_${TIMESTAMP}*"

        log_success "Uploaded to S3"
    fi
}

# ============================================
# Restore Functions
# ============================================

restore_surrealdb() {
    local backup_file="$1"
    log_info "Restoring SurrealDB from $backup_file..."

    if [[ "$backup_file" == *.surql ]]; then
        docker exec -i novacortex-surrealdb /surreal import \
            --conn http://localhost:8000 \
            --user "${SURREALDB_USER}" \
            --pass "${SURREALDB_PASS}" \
            --ns "${SURREALDB_NAMESPACE:-novacortex}" \
            --db "${SURREALDB_DATABASE:-production}" \
            < "$backup_file"
    else
        docker compose down surrealdb
        docker run --rm \
            -v novacortex_surrealdb-data:/data \
            -v "$(dirname "$backup_file"):/backup:ro" \
            alpine tar xzf "/backup/$(basename "$backup_file")" -C /data
        docker compose up -d surrealdb
    fi

    log_success "SurrealDB restored"
}

restore_qdrant() {
    local backup_file="$1"
    log_info "Restoring Qdrant from $backup_file..."

    docker compose down qdrant
    docker run --rm \
        -v novacortex_qdrant-data:/data \
        -v "$(dirname "$backup_file"):/backup:ro" \
        alpine sh -c "rm -rf /data/* && tar xzf '/backup/$(basename "$backup_file")' -C /data"
    docker compose up -d qdrant

    log_success "Qdrant restored"
}

restore_redis() {
    local backup_file="$1"
    log_info "Restoring Redis from $backup_file..."

    docker compose down redis
    docker run --rm \
        -v novacortex_redis-data:/data \
        -v "$(dirname "$backup_file"):/backup:ro" \
        alpine cp "/backup/$(basename "$backup_file")" /data/dump.rdb
    docker compose up -d redis

    log_success "Redis restored"
}

# ============================================
# Main
# ============================================

main() {
    echo ""
    echo "============================================"
    echo "  NovaCortex Backup"
    echo "  Timestamp: $TIMESTAMP"
    echo "============================================"
    echo ""

    create_backup_dir
    backup_surrealdb
    backup_qdrant
    backup_redis
    cleanup_old_backups
    upload_to_s3

    echo ""
    log_success "All backups completed!"
    echo ""
    echo "Backup location: $BACKUP_DIR"
    ls -la "$BACKUP_DIR"/*/ 2>/dev/null || true
}

# ============================================
# CLI
# ============================================

case "${1:-backup}" in
    backup)
        main
        ;;
    restore)
        service="${2:-}"
        file="${3:-}"
        if [ -z "$service" ] || [ -z "$file" ]; then
            echo "Usage: $0 restore {surrealdb|qdrant|redis} <backup_file>"
            exit 1
        fi
        case "$service" in
            surrealdb) restore_surrealdb "$file" ;;
            qdrant) restore_qdrant "$file" ;;
            redis) restore_redis "$file" ;;
            *) echo "Unknown service: $service"; exit 1 ;;
        esac
        ;;
    list)
        find "$BACKUP_DIR" -type f -name "*.tar.gz" -o -name "*.surql" -o -name "*.rdb" | sort -r
        ;;
    *)
        echo "Usage: $0 {backup|restore|list}"
        exit 1
        ;;
esac
