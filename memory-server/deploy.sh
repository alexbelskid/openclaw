#!/bin/bash
# Deploy memory-server + nginx on a client VPS
# Usage: ./deploy.sh <vps-ip> [memory-api-token]
#
# Prerequisites on VPS: nginx, node, npm, pm2

set -euo pipefail

VPS="${1:?Usage: ./deploy.sh <vps-ip> [memory-api-token]}"
TOKEN="${2:-$(openssl rand -hex 24)}"

echo "==> Deploying memory-server to $VPS"
echo "    Token: $TOKEN"

# Copy memory-server files
scp -r index.js package.json "root@$VPS:/opt/memory-server/"

# Install dependencies, create .env, start with pm2
ssh "root@$VPS" bash <<REMOTE
set -euo pipefail

cd /opt/memory-server
npm install --production

cat > .env <<'ENV'
MEMORY_API_TOKEN=$TOKEN
WORKSPACE_DIR=/root/.openclaw/workspace
PORT=3001
ENV

# Load env and start/restart with pm2
pm2 delete memory-server 2>/dev/null || true
pm2 start index.js --name memory-server --env-file .env
pm2 save

# Install nginx config
cp /opt/memory-server/nginx-belagent.conf /etc/nginx/sites-available/belagent 2>/dev/null || true
ln -sf /etc/nginx/sites-available/belagent /etc/nginx/sites-enabled/ 2>/dev/null || true
nginx -t && systemctl reload nginx

echo "==> memory-server deployed and running on port 3001"
echo "==> nginx configured: /api/memory/* → :3001, /* → :19789"
REMOTE

# Copy nginx config too
scp nginx-belagent.conf "root@$VPS:/opt/memory-server/"

echo ""
echo "Done. Update cloudflared to point to http://localhost:80 instead of :19789"
echo "Token: $TOKEN"
