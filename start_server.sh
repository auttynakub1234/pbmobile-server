#!/usr/bin/env bash
# Start Point Blank Mobile Server

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
cd "$DIR"

PORT="${PORT:-3000}"

# Check if already running
PID=$(pgrep -f "node.*pb_server.js")
if [ -n "$PID" ]; then
  echo "⚠️ Server is already running on PID: $PID"
  exit 0
fi

echo "🚀 Starting Point Blank Mobile Server on port $PORT..."
nohup node pb_server.js > server.log 2>&1 &
NEW_PID=$!
sleep 1

if ps -p $NEW_PID > /dev/null; then
  echo "✅ Server started successfully! PID: $NEW_PID"
  echo "🎮 Play game at: http://localhost:$PORT/"
  echo "📊 Admin panel: http://localhost:$PORT/admin"
  echo "📄 Logs: tail -f server.log"
else
  echo "❌ Failed to start server. Check server.log for errors."
fi
