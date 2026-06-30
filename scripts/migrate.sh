#!/bin/bash
# ============================================
# NovaCortex Database Migration Script
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
MIGRATIONS_DIR="${PROJECT_DIR}/packages/api/migrations"

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

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ============================================
# SurrealDB Migration Functions
# ============================================

wait_for_surrealdb() {
    log_info "Waiting for SurrealDB to be ready..."

    local retries=30
    local count=0

    while [ $count -lt $retries ]; do
        if docker exec novacortex-surrealdb /surreal isready --conn http://localhost:8000 2>/dev/null; then
            log_success "SurrealDB is ready"
            return 0
        fi
        count=$((count + 1))
        sleep 2
    done

    log_error "SurrealDB did not become ready in time"
    exit 1
}

run_surrealdb_migration() {
    local migration_file="$1"
    local migration_name=$(basename "$migration_file")

    log_info "Running migration: $migration_name"

    docker exec -i novacortex-surrealdb /surreal sql \
        --conn http://localhost:8000 \
        --user "${SURREALDB_USER}" \
        --pass "${SURREALDB_PASS}" \
        --ns "${SURREALDB_NAMESPACE:-novacortex}" \
        --db "${SURREALDB_DATABASE:-production}" \
        < "$migration_file"

    log_success "Migration completed: $migration_name"
}

get_applied_migrations() {
    docker exec -i novacortex-surrealdb /surreal sql \
        --conn http://localhost:8000 \
        --user "${SURREALDB_USER}" \
        --pass "${SURREALDB_PASS}" \
        --ns "${SURREALDB_NAMESPACE:-novacortex}" \
        --db "${SURREALDB_DATABASE:-production}" \
        --json \
        <<< "SELECT name FROM migrations ORDER BY applied_at;" 2>/dev/null | \
        jq -r '.[0].result[]?.name // empty' 2>/dev/null || echo ""
}

record_migration() {
    local migration_name="$1"

    docker exec -i novacortex-surrealdb /surreal sql \
        --conn http://localhost:8000 \
        --user "${SURREALDB_USER}" \
        --pass "${SURREALDB_PASS}" \
        --ns "${SURREALDB_NAMESPACE:-novacortex}" \
        --db "${SURREALDB_DATABASE:-production}" \
        <<< "CREATE migrations SET name = '$migration_name', applied_at = time::now();"
}

# ============================================
# Qdrant Collection Setup
# ============================================

setup_qdrant_collections() {
    log_info "Setting up Qdrant collections..."

    local QDRANT_URL="http://localhost:6333"
    local headers=""

    if [ -n "${QDRANT_API_KEY:-}" ]; then
        headers="-H 'api-key: ${QDRANT_API_KEY}'"
    fi

    # Create memories collection
    curl -s -X PUT "${QDRANT_URL}/collections/memories" \
        -H "Content-Type: application/json" \
        ${headers} \
        -d '{
            "vectors": {
                "size": 1536,
                "distance": "Cosine"
            },
            "optimizers_config": {
                "memmap_threshold": 20000
            },
            "replication_factor": 1,
            "write_consistency_factor": 1
        }' > /dev/null 2>&1 || log_warning "memories collection may already exist"

    # Create embeddings collection
    curl -s -X PUT "${QDRANT_URL}/collections/embeddings" \
        -H "Content-Type: application/json" \
        ${headers} \
        -d '{
            "vectors": {
                "size": 1536,
                "distance": "Cosine"
            },
            "optimizers_config": {
                "memmap_threshold": 20000
            }
        }' > /dev/null 2>&1 || log_warning "embeddings collection may already exist"

    # Create indexes
    curl -s -X PUT "${QDRANT_URL}/collections/memories/index" \
        -H "Content-Type: application/json" \
        ${headers} \
        -d '{
            "field_name": "namespace",
            "field_schema": "keyword"
        }' > /dev/null 2>&1 || true

    curl -s -X PUT "${QDRANT_URL}/collections/memories/index" \
        -H "Content-Type: application/json" \
        ${headers} \
        -d '{
            "field_name": "memory_type",
            "field_schema": "keyword"
        }' > /dev/null 2>&1 || true

    log_success "Qdrant collections configured"
}

# ============================================
# Run All Migrations
# ============================================

run_migrations() {
    log_info "Starting migrations..."

    # Ensure migrations table exists
    docker exec -i novacortex-surrealdb /surreal sql \
        --conn http://localhost:8000 \
        --user "${SURREALDB_USER}" \
        --pass "${SURREALDB_PASS}" \
        --ns "${SURREALDB_NAMESPACE:-novacortex}" \
        --db "${SURREALDB_DATABASE:-production}" \
        <<< "DEFINE TABLE IF NOT EXISTS migrations SCHEMAFULL;
             DEFINE FIELD name ON TABLE migrations TYPE string;
             DEFINE FIELD applied_at ON TABLE migrations TYPE datetime;
             DEFINE INDEX migrations_name ON TABLE migrations FIELDS name UNIQUE;" 2>/dev/null || true

    # Get applied migrations
    local applied=$(get_applied_migrations)

    # Run pending migrations
    if [ -d "$MIGRATIONS_DIR" ]; then
        for migration_file in "$MIGRATIONS_DIR"/*.surql; do
            if [ -f "$migration_file" ]; then
                local migration_name=$(basename "$migration_file")

                if echo "$applied" | grep -q "^${migration_name}$"; then
                    log_info "Skipping (already applied): $migration_name"
                else
                    run_surrealdb_migration "$migration_file"
                    record_migration "$migration_name"
                fi
            fi
        done
    else
        log_warning "No migrations directory found at $MIGRATIONS_DIR"
    fi

    log_success "All migrations completed"
}

# ============================================
# Create New Migration
# ============================================

create_migration() {
    local name="${1:-}"

    if [ -z "$name" ]; then
        log_error "Migration name required"
        echo "Usage: $0 create <migration_name>"
        exit 1
    fi

    mkdir -p "$MIGRATIONS_DIR"

    local timestamp=$(date +"%Y%m%d%H%M%S")
    local filename="${MIGRATIONS_DIR}/${timestamp}_${name}.surql"

    cat > "$filename" << 'EOF'
-- Migration: ${name}
-- Created: $(date)

-- Add your SurrealDB migration statements here
-- Example:
-- DEFINE TABLE IF NOT EXISTS example SCHEMAFULL;
-- DEFINE FIELD name ON TABLE example TYPE string;
-- DEFINE FIELD created_at ON TABLE example TYPE datetime DEFAULT time::now();

EOF

    log_success "Created migration: $filename"
}

# ============================================
# Rollback Migration
# ============================================

rollback_migration() {
    local count="${1:-1}"

    log_warning "Rollback not implemented - SurrealDB migrations should be reversible manually"
    log_info "Last $count applied migrations:"

    docker exec -i novacortex-surrealdb /surreal sql \
        --conn http://localhost:8000 \
        --user "${SURREALDB_USER}" \
        --pass "${SURREALDB_PASS}" \
        --ns "${SURREALDB_NAMESPACE:-novacortex}" \
        --db "${SURREALDB_DATABASE:-production}" \
        <<< "SELECT * FROM migrations ORDER BY applied_at DESC LIMIT $count;"
}

# ============================================
# Main
# ============================================

main() {
    echo ""
    echo "============================================"
    echo "  NovaCortex Database Migrations"
    echo "============================================"
    echo ""

    wait_for_surrealdb
    run_migrations
    setup_qdrant_collections

    echo ""
    log_success "All database setup completed!"
}

# ============================================
# CLI
# ============================================

case "${1:-run}" in
    run|migrate)
        main
        ;;
    create)
        create_migration "${2:-}"
        ;;
    rollback)
        rollback_migration "${2:-1}"
        ;;
    status)
        log_info "Applied migrations:"
        get_applied_migrations
        ;;
    setup-qdrant)
        setup_qdrant_collections
        ;;
    *)
        echo "Usage: $0 {run|create|rollback|status|setup-qdrant}"
        exit 1
        ;;
esac
