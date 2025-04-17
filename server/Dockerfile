FROM node:18-alpine

WORKDIR /app

# Install Python, build dependencies, and PostgreSQL client
RUN apk add --no-cache python3 make g++ gcc postgresql-client

COPY package*.json ./
COPY pnpm-lock.yaml ./

RUN npm install -g pnpm

RUN pnpm install

COPY . .

RUN npx prisma generate

RUN pnpm run build

EXPOSE 3001

# Create a startup script to handle database initialization and migration
COPY ./docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
