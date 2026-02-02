# Build stage
FROM node:20-alpine AS builder

# Install Go for agent compilation
RUN apk add --no-cache go

WORKDIR /app

# Copy package files from backend
COPY backend/package*.json ./backend/
RUN cd backend && npm install

# Copy agent and backend source
COPY agent ./agent
COPY backend ./backend

# Build backend
RUN cd backend && npm run build

# Production stage
FROM node:20-alpine

# Install Go for runtime agent compilation
RUN apk add --no-cache go

WORKDIR /app

# Copy dependencies and build artifacts
COPY backend/package*.json ./
RUN npm install --omit=dev

COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/agent ./agent

EXPOSE 5001

# Set the port explicitly
ENV PORT=5001

CMD ["node", "dist/index.js"]
