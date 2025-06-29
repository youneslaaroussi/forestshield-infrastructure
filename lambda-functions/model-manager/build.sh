#!/bin/bash

# ForestShield Model Manager Build Script
# Creates deployment package for model management Lambda

set -e

echo "🗄️ Building ForestShield Model Manager..."

# Clean previous build
rm -f model-manager-deployment.zip

# Create deployment package (no external dependencies, just Python code)
echo "📦 Creating deployment package..."
zip -r model-manager-deployment.zip \
    handler.py \
    requirements.txt

echo "✅ Model Manager build completed!"
echo "📊 Package size: $(du -h model-manager-deployment.zip | cut -f1)"

# Verify package contents
echo "📋 Package contents:"
unzip -l model-manager-deployment.zip
