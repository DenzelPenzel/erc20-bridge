#!/bin/sh
set -e

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
  if PGPASSWORD=postgres psql -h postgres -U postgres -d postgres -c "SELECT 1" > /dev/null 2>&1; then
    echo "PostgreSQL is ready!"
    
    # Check if our database exists
    if PGPASSWORD=postgres psql -h postgres -U postgres -lqt | cut -d \| -f 1 | grep -qw erc20_bridge; then
      echo "Database erc20_bridge exists"
    else
      echo "Creating database erc20_bridge"
      PGPASSWORD=postgres psql -h postgres -U postgres -c "CREATE DATABASE erc20_bridge;"
      echo "Database created successfully"
    fi
    
    break
  fi
  attempt=$((attempt+1))
  echo "Waiting for PostgreSQL... attempt $attempt of $max_attempts"
  sleep 2
done

if [ $attempt -eq $max_attempts ]; then
  echo "PostgreSQL did not become ready in time. Exiting."
  exit 1
fi

# Run database migrations
echo "Running database migrations..."
npx prisma migrate deploy

echo "Checking if database needs restoration..."
record_count=$(PGPASSWORD=postgres psql -h postgres -U postgres -d erc20_bridge -t -c "SELECT COUNT(*) FROM bridge_transactions;" 2>/dev/null || echo "0")
record_count=$(echo $record_count | tr -d ' ')

if [ "$record_count" = "0" ]; then
  echo "Database appears to be empty. Checking for backups to restore..."
  
  latest_backup=$(ls -t /backup/erc20_bridge_*.sql.gz 2>/dev/null | head -n 1)
  
  if [ -n "$latest_backup" ]; then
    echo "Found backup: $latest_backup. Attempting to restore..."
    
    backup_filename=$(basename "$latest_backup")
    
    echo "Executing restore from $backup_filename"
    PGPASSWORD=postgres /scripts/restore-database.sh "$backup_filename"
    
    echo "Database restored successfully!"
  else
    echo "No backups found. Starting with a fresh database."
  fi
else
  echo "Database already contains data. No restoration needed."
fi

echo "Starting the application..."
exec pnpm run start:prod
