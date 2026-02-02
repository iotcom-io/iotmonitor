# Build stage
FROM node:20-alpine AS builder

# Install Go for agent compilation
RUN apk add --no-cache go

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine

# Install Go for runtime agent compilation
RUN apk add --no-cache go

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist

EXPOSE 5000

CMD ["npm", "start"]
