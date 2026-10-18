#!/bin/bash
# Script de configuración WSL para build Flatpak de Yoru-Reader
# Ejecutar desde Ubuntu (WSL): bash /mnt/c/Users/zams/.gemini/antigravity/scratch/Yoru-Reader/build/setup-wsl-flatpak.sh

set -e
PROJECT="/mnt/c/Users/zams/.gemini/antigravity/scratch/Yoru-Reader"

echo "========================================"
echo " Setup WSL para Yoru-Reader Flatpak"
echo "========================================"

# 1. Instalar dependencias del sistema
echo ""
echo "[1/4] Instalando flatpak y flatpak-builder..."
sudo apt-get update -y
sudo apt-get install -y flatpak flatpak-builder elfutils

# 2. Agregar Flathub como usuario
echo ""
echo "[2/4] Configurando Flathub (usuario)..."
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# 3. Instalar runtimes de Electron
echo ""
echo "[3/4] Instalando runtimes de Flatpak (puede tardar varios minutos)..."
flatpak install --user -y --noninteractive flathub \
  org.freedesktop.Platform//24.08 \
  org.freedesktop.Sdk//24.08 \
  org.electronjs.Electron2.BaseApp//24.08

# 4. Instalar nvm + Node si no está
echo ""
echo "[4/4] Verificando Node.js..."
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
if ! command -v node &> /dev/null; then
  echo "Instalando Node.js 22 via nvm..."
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  export NVM_DIR="$HOME/.nvm"
  \. "$NVM_DIR/nvm.sh"
  nvm install 22
fi
node --version
npm --version

echo ""
echo "========================================"
echo " Setup completado! Iniciando build..."
echo "========================================"

cd "$PROJECT"
npm install --ignore-scripts
npx vite build
npx electron-builder --linux flatpak --x64 --config.directories.output=releases/linux

echo ""
echo "========================================"
echo " Build listo!"
ls -lh releases/linux/*.flatpak
echo "========================================"
