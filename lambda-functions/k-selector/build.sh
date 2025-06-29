#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "🎯 Building K-Selector Lambda function..."

# Build the Docker image
docker build --tag k-selector-package:latest .

# Create a container and extract the package
# Using a temporary name with a timestamp to avoid conflicts
CONTAINER_NAME="k-selector-temp-$(date +%s)"
trap "docker rm -f $CONTAINER_NAME > /dev/null 2>&1" EXIT # Ensure cleanup

docker run --name $CONTAINER_NAME -d k-selector-package:latest sleep 10
docker cp $CONTAINER_NAME:/tmp/package.zip ./k-selector-lambda.zip

# Final check to ensure the file exists before declaring victory
if [ ! -f "k-selector-lambda.zip" ]; then
    echo "❌ FATAL ERROR: k-selector-lambda.zip was NOT created."
    exit 1
fi

echo ""
echo "****************************************************************"
echo "📦 Package created: k-selector-lambda.zip"
echo "🐍 This package includes properly compiled numpy and dependencies."
echo "****************************************************************"
echo ""

# Check package size
PACKAGE_SIZE=$(du -h k-selector-lambda.zip | cut -f1)
echo "📊 Package size: $PACKAGE_SIZE"

if [[ $(du -k k-selector-lambda.zip | cut -f1) -gt 51200 ]]; then
    echo "⚠️  WARNING: Package size exceeds 50MB Lambda limit!"
    echo "   Consider using Lambda layers for large dependencies."
else
    echo "✅ Package size within Lambda limits"
fi 