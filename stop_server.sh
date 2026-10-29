#!/usr/bin/env bash
# Stop Point Blank Mobile Server

PID=$(pgrep -f "node.*pb_server.js")
if [ -z "$PID" ]; then
  echo "ℹ️ No running Point Blank Mobile server found."
  exit 0
fi

echo "🛑 Stopping server PID: $PID..."
kill -15 $PID
sleep 1

if pgrep -f "node.*pb_server.js" > /dev/null; then
  echo "⚠️ Force killing..."
  kill -9 $PID
fi
echo "✅ Server stopped."
