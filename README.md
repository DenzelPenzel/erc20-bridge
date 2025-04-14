# ERC20 Bridge

This guide provides instructions for deploying the ERC20 Bridge project. 
This setup includes the NestJS backend service, React UI, PostgreSQL database, and Redis for queue management.

## Deployment

### 1. Build and Start the Containers

```bash
# Build and start all services
docker-compose up -d

# Check if all containers are running
docker-compose ps
```

### 2. Initialize the Database

The database migrations will run automatically when the backend container starts, but you can also run them manually:

```bash
docker-compose exec backend npx prisma migrate deploy
```

### 3. Set Bridge Operators

If needed, run the script to set bridge operators:

```bash
docker-compose exec backend node scripts/setBridgeOperator.js <operator_address> arbitrum
docker-compose exec backend node scripts/setBridgeOperator.js <operator_address> optimism
```

## Accessing the Application

Once deployed, you can access:

- Frontend UI: `http://your_server_ip`
- Backend API: `http://your_server_ip:3001`