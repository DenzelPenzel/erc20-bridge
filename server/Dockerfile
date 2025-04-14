FROM node:18-alpine

WORKDIR /app

# Install Python and build dependencies
RUN apk add --no-cache python3 make g++ gcc

COPY package*.json ./
COPY pnpm-lock.yaml ./

RUN npm install -g pnpm

RUN pnpm install

COPY . .

RUN npx prisma generate

RUN pnpm run build

EXPOSE 3001

CMD ["sh", "-c", "npx prisma migrate deploy && pnpm run start:prod"]
