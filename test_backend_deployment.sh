#!/bin/bash

# Test script to verify backend deployment
echo "🔍 Testing AI Sales Assistant Backend Deployment"
echo "================================================"

BACKEND_URL="https://ai-sales-assistant-backend-te68.onrender.com"

echo ""
echo "1. Testing root endpoint..."
curl -s "$BACKEND_URL/" | head -5
echo ""

echo "2. Testing /api/health endpoint..."
curl -s "$BACKEND_URL/api/health" | head -10
echo ""

echo "3. Testing CORS headers..."
curl -s -H "Origin: https://ai-sales-assistant-frontend.onrender.com" \
     -I "$BACKEND_URL/api/communities" 2>&1 | grep -i "access-control"
echo ""

echo "4. Testing /api/communities endpoint..."
curl -s "$BACKEND_URL/api/communities" | head -20
echo ""

echo "================================================"
echo "✅ If you see JSON responses above, the backend is working!"
echo "❌ If you see HTML or 'Cannot GET', the Flask app isn't running."

