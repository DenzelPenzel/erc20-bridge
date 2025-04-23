#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/backup"
DB_HOST="postgres"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_NAME="erc20_bridge"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/erc20_bridge_${TIMESTAMP}.sql"

# Ensure backup directory exists
mkdir -p ${BACKUP_DIR}

echo "Starting backup of ${DB_NAME} database at $(date)"

# Create the backup
pg_dump -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -F p > ${BACKUP_FILE}

# Compress the backup
gzip -f ${BACKUP_FILE}
COMPRESSED_FILE="${BACKUP_FILE}.gz"

echo "Backup completed: ${COMPRESSED_FILE}"

# Keep only the last 7 backups to save space
find ${BACKUP_DIR} -name "erc20_bridge_*.sql.gz" -type f -mtime +7 -delete

echo "Cleanup completed. Backup process finished at $(date)"
