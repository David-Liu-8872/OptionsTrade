#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 启动 Moomoo 美股稳健期权雷达后端 (Port 8000)..."
(
  cd "$ROOT_DIR/backend"
  PYTHONPATH="$ROOT_DIR/backend" ./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
) &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "正在停止服务..."
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "🎨 启动可视化前端工作台 (http://localhost:5173)..."
cd "$ROOT_DIR/frontend"
npm run dev -- --host 127.0.0.1 --port 5173
