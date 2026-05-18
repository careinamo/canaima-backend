#!/bin/bash

# Script de despliegue para Canaima Backend
# Uso: ./deploy.sh [stage] [region]
# Ejemplo: ./deploy.sh dev us-west-2
#          ./deploy.sh prod us-east-1

set -e

# Valores por defecto
STAGE="${1:-dev}"
REGION="${2:-us-west-2}"

echo "╔════════════════════════════════════════════╗"
echo "║     Canaima Backend - Deployment Script    ║"
echo "╚════════════════════════════════════════════╝"
echo ""
echo "Configuración:"
echo "  Stage:  $STAGE"
echo "  Region: $REGION"
echo ""

# Validar que las herramientas necesarias estén instaladas
if ! command -v serverless &> /dev/null; then
    echo "❌ Error: Serverless Framework no está instalado"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm no está instalado"
    exit 1
fi

# Construir el proyecto
echo "📦 Compilando TypeScript..."
npm run build

if [ $? -eq 0 ]; then
    echo "✓ Compilación exitosa"
else
    echo "❌ La compilación falló"
    exit 1
fi

# Desplegar
echo ""
echo "🚀 Iniciando despliegue..."
serverless deploy --stage "$STAGE" --region "$REGION"

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Despliegue completado exitosamente"
    echo ""
    echo "Info del despliegue:"
    echo "  Stage:  $STAGE"
    echo "  Region: $REGION"
    echo "  Stack:  canaima-backend-$STAGE"
else
    echo "❌ El despliegue falló"
    exit 1
fi
