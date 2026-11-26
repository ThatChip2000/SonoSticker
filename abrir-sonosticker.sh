#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 20+ no está instalado. Descárgalo desde https://nodejs.org/"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Instalando dependencias por primera vez..."
  npm install
fi

exec npm start
