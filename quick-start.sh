#!/bin/bash

# IoT Monitor - Quick Start Script
# This script helps you get the IoT Monitor stack up and running quickly

set -e

echo "=================================="
echo "IoT Monitor - Docker Quick Start"
echo "=================================="
echo ""

# Check if docker is installed
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if docker-compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "Error: Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Check if .env file exists
if [ ! -f "backend/.env" ]; then
    echo "Creating .env file from example..."
    cp backend/.env.example backend/.env
    echo "⚠️  Please edit backend/.env and update JWT_SECRET before deploying to production!"
fi

echo "Step 1: Building Docker images..."
docker-compose build

echo ""
echo "Step 2: Starting all services..."
docker-compose up -d

echo ""
echo "Step 3: Waiting for services to be ready..."
sleep 10

# Check if backend is healthy
if docker-compose ps | grep -q "iotmonitor-backend.*Up"; then
    echo "✓ Backend is running"
else
    echo "✗ Backend failed to start. Check logs with: docker-compose logs backend"
    exit 1
fi

# Check if frontend is healthy
if docker-compose ps | grep -q "iotmonitor-frontend.*Up"; then
    echo "✓ Frontend is running"
else
    echo "✗ Frontend failed to start. Check logs with: docker-compose logs frontend"
    exit 1
fi

# Check if MongoDB is healthy
if docker-compose ps | grep -q "iotmonitor-mongodb.*Up"; then
    echo "✓ MongoDB is running"
else
    echo "✗ MongoDB failed to start. Check logs with: docker-compose logs mongodb"
    exit 1
fi

echo ""
echo "Step 4: Initializing database..."
echo "Running seed script (this may take a moment)..."
docker-compose exec -T backend npm run seed || echo "⚠️  Seed script failed or was already run"

echo ""
echo "=================================="
echo "✓ IoT Monitor is ready!"
echo "=================================="
echo ""
echo "Access the application:"
echo "  Frontend:  http://localhost:3000"
echo "  Backend:   http://localhost:5001"
echo "  MongoDB:   mongodb://localhost:27017"
echo "  MQTT:      mqtt://localhost:1883"
echo ""
echo "Useful commands:"
echo "  View logs:        docker-compose logs -f"
echo "  Stop services:    docker-compose down"
echo "  Restart service:  docker-compose restart <service-name>"
echo ""
echo "For more information, see DOCKER_DEPLOYMENT.md"
echo ""
