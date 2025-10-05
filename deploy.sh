#!/bin/bash

# Cloudflare AI Support Bot Deployment Script

set -e

echo "🚀 Starting deployment of CF AI Support Bot..."

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "❌ Wrangler CLI not found. Please install it first:"
    echo "npm install -g wrangler"
    exit 1
fi

# Check if user is logged in
if ! wrangler whoami &> /dev/null; then
    echo "❌ Not logged in to Cloudflare. Please run:"
    echo "wrangler login"
    exit 1
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Deploy Workers
echo "🔧 Deploying Workers..."
wrangler deploy

# Deploy Pages (if pages/dist exists)
if [ -d "pages/dist" ]; then
    echo "📄 Deploying Pages..."
    wrangler pages deploy pages/dist
else
    echo "⚠️  Pages dist directory not found. Skipping Pages deployment."
fi

echo "✅ Deployment complete!"
echo "🌐 Your AI Support Bot is now live!"

# Show deployment info
echo ""
echo "📋 Deployment Information:"
wrangler deployments list --name cf-ai-supportbot | head -5