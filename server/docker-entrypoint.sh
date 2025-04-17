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

# Start the application
echo "Starting the application..."
exec pnpm run start:prod
