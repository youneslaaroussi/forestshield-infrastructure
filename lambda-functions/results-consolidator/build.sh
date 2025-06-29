#!/bin/bash

# ForestShield Results Consolidator Build Script
# Creates deployment package for results consolidation Lambda with PDF generation using Docker

set -e

echo "🔄 Building ForestShield Results Consolidator with Docker..."

# Clean previous build
rm -f results-consolidator-deployment.zip

# Build the Docker image
echo "🐳 Building Docker image..."
docker build --tag results-consolidator-package:latest .

# Create a container and extract the package
echo "📦 Extracting deployment package..."
CONTAINER_NAME="results-consolidator-temp-$(date +%s)"
trap "docker rm -f $CONTAINER_NAME > /dev/null 2>&1" EXIT # Ensure cleanup

docker run --name $CONTAINER_NAME -d results-consolidator-package:latest sleep 10
docker cp $CONTAINER_NAME:/tmp/package.zip ./results-consolidator-deployment.zip

# Final check to ensure the file exists
if [ ! -f "results-consolidator-deployment.zip" ]; then
    echo "❌ FATAL ERROR: results-consolidator-deployment.zip was NOT created."
    exit 1
fi

echo ""
echo "****************************************************************"
echo "✅ Results Consolidator build completed!"
echo "📊 Package size: $(du -h results-consolidator-deployment.zip | cut -f1)"
echo "📄 Package created: results-consolidator-deployment.zip"
echo "🔧 This package includes compiled PIL/Pillow for reportlab PDF generation"
echo "****************************************************************"
echo ""

# Verify package contents
echo "📋 Package contents (first 20 items):"
unzip -l results-consolidator-deployment.zip | head -20 