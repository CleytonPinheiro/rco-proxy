#!/bin/bash
set -e

echo "[post-merge] Instalando dependências do backend..."
cd backend && npm install --prefer-offline 2>&1 | tail -5
cd ..

echo "[post-merge] Concluído."
