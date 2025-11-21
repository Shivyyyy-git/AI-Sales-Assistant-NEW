#!/bin/bash

# AI Sales Assistant - Single Command Startup Script
# This script starts both the backend API and frontend dev server

echo "🚀 Starting AI Sales Assistant..."
echo ""

# Check if backend virtual environment exists
if [ ! -d "backend/venv" ]; then
    echo "❌ Backend virtual environment not found!"
    echo "Please run: cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

# Check if frontend dependencies are installed
if [ ! -d "frontend/node_modules" ]; then
    echo "❌ Frontend dependencies not installed!"
    echo "Please run: cd frontend && npm install"
    exit 1
fi

# Start backend API server in background
echo "📡 Starting Flask API server (port 5050)..."
cd backend
source venv/bin/activate
python app.py > ../backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to initialize
sleep 2

# Check if backend started successfully
if ! curl -s http://localhost:5050/api/health > /dev/null 2>&1; then
    echo "❌ Backend failed to start. Check backend.log for errors."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi

echo "✅ Backend API running on http://localhost:5050"
echo ""

# Start frontend dev server
echo "🎨 Starting React frontend (port 3000)..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✨ Application ready at: http://localhost:3000"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Ctrl+C to stop both servers"
echo ""

cd frontend
npm run dev

# Cleanup: when frontend stops, kill backend too
echo ""
echo "🛑 Shutting down backend..."
kill $BACKEND_PID 2>/dev/null
echo "✅ All servers stopped"

