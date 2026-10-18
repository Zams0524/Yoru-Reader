#!/bin/bash
set -e

PROJECT_DIR="/project"
cd "$PROJECT_DIR"

echo "==> Instalando dependencias npm..."
npm install --ignore-scripts 2>&1 | tail -5

echo "==> Construyendo con electron-builder (Flatpak)..."
npx electron-builder --linux flatpak --x64 \
  --config.directories.output=releases/linux \
  2>&1

echo "==> ¡Flatpak listo!"
ls -lh releases/linux/*.flatpak 2>/dev/null || ls -lh releases/linux/
