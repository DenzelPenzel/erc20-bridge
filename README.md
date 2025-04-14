# ERC20 Bridge

This guide provides instructions for deploying the ERC20 Bridge project. 
This setup includes the NestJS backend service, React UI, PostgreSQL database, and Redis for queue management.

## Project Structure

The project consists of three main components:

### 1. `my-erc20-bridge`
Smart contract implementation of the ERC20 bridge using Foundry framework:
- `src/`: Contains the smart contract code, including `MockERC20.sol`
- `script/`: Deployment scripts for the contracts
- `test/`: Contract test files
- `lib/`: External dependencies and libraries

### 2. `server` (NestJS Backend)
Backend service that handles bridge operations and blockchain interactions:
- `src/`: Main source code
  - `bridge/`: Bridge-related services and controllers
  - `events/`: Blockchain event listeners
  - `queue/`: Queue processing for asynchronous tasks
  - `mint/`: Token minting functionality
  - `contracts/`: Contract interfaces and ABIs
- `prisma/`: Prisma ORM schema and migrations
- `scripts/`: Utility scripts including bridge operator setup

### 3. `bridge-ui` (React Frontend)
User interface for interacting with the bridge:
- `src/`: Frontend source code
  - `components/`: UI components
  - `api/`: API integration with backend
  - `context/`: React context providers
  - `contracts/`: Contract interfaces for frontend
  - `utils/`: Utility functions

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