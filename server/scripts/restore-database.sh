#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/backup"
DB_HOST="postgres"
DB_USER="postgres"
DB_PASSWORD="postgres"
DB_NAME="erc20_bridge"

# Check if backup file is provided
if [ -z "$1" ]; then
  echo "Usage: $0 <backup_filename>"
  echo "Available backups:"
  ls -la ${BACKUP_DIR}/*.gz 2>/dev/null || echo "No backups found in ${BACKUP_DIR}"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "${BACKUP_DIR}/${BACKUP_FILE}" ]; then
  echo "Backup file ${BACKUP_DIR}/${BACKUP_FILE} not found"
  echo "Available backups:"
  ls -la ${BACKUP_DIR}/*.gz 2>/dev/null || echo "No backups found in ${BACKUP_DIR}"
  exit 1
fi

echo "Starting restore of ${DB_NAME} database from ${BACKUP_FILE} at $(date)"

# If compressed, uncompress first
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  echo "Uncompressing backup file..."
  gunzip -c "${BACKUP_DIR}/${BACKUP_FILE}" > "${BACKUP_DIR}/temp_restore.sql"
  RESTORE_FILE="${BACKUP_DIR}/temp_restore.sql"
else
  RESTORE_FILE="${BACKUP_DIR}/${BACKUP_FILE}"
fi

# Drop and recreate the database
echo "Dropping existing database..."
PGPASSWORD=${DB_PASSWORD} psql -h ${DB_HOST} -U ${DB_USER} -c "DROP DATABASE IF EXISTS ${DB_NAME};"
echo "Creating fresh database..."
PGPASSWORD=${DB_PASSWORD} psql -h ${DB_HOST} -U ${DB_USER} -c "CREATE DATABASE ${DB_NAME};"

# Restore from backup
echo "Restoring from backup..."
PGPASSWORD=${DB_PASSWORD} psql -h ${DB_HOST} -U ${DB_USER} -d ${DB_NAME} -f "${RESTORE_FILE}"

# Cleanup temp file if we created one
if [[ "${BACKUP_FILE}" == *.gz ]]; then
  rm "${RESTORE_FILE}"
fi

echo "Restore completed at $(date)"
echo "You may need to restart your application to connect to the restored database"
