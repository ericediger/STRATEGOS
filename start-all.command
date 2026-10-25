#!/bin/bash
#
# STRATEGOS — Launch all services
#
# Usage: double-click this file or run ./start-all.command
#

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "╔══════════════════════════════════════╗"
echo "║     STRATEGOS — Starting Services    ║"
echo "╚══════════════════════════════════════╝"
echo ""

# EDR Server (port 9001) — start first, research engine depends on it
echo "[1/5] Starting EDR Server (port 9001)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR/research/edr-node' && npx tsx src/index.ts\""

sleep 1

# Research Engine (port 4456)
echo "[2/5] Starting Research Engine (port 4456)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR/research' && npm run dev\""

sleep 1

# Citation Verifier (port 9002)
echo "[3/5] Starting Citation Verifier (port 9002)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR/research/citation-verifier' && npx tsx src/index.ts\""

sleep 1

# Backend API (port 4000)
echo "[4/5] Starting Backend API (port 4000)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR/backend' && npm run dev\""

# Brief pause to let backend start first
sleep 2

# Frontend (port 5174)
echo "[5/5] Starting Frontend (port 5174)..."
osascript -e "tell application \"Terminal\" to do script \"cd '$SCRIPT_DIR/frontend' && npm run dev\""

echo ""
echo "Services starting..."
echo "  EDR Server:        http://localhost:9001"
echo "  Research Engine:   http://localhost:4456"
echo "  Citation Verifier: http://localhost:9002"
echo "  Backend API:       http://localhost:4000"
echo "  Frontend:          http://localhost:5174"
echo ""
echo "Open http://localhost:5174 in your browser."
