#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "🎨 Building Visualization Generator Lambda function with Docker..."

# Build the Docker image
docker build --tag visualization-generator-package:latest .

# Create a container and extract the package
# Using a temporary name with a timestamp to avoid conflicts
CONTAINER_NAME="visualization-generator-temp-$(date +%s)"
trap "docker rm -f $CONTAINER_NAME > /dev/null 2>&1" EXIT # Ensure cleanup

docker run --name $CONTAINER_NAME -d visualization-generator-package:latest sleep 10
docker cp $CONTAINER_NAME:/tmp/package.zip ./visualization-generator-deployment.zip

# Final check to ensure the file exists before declaring victory
if [ ! -f "visualization-generator-deployment.zip" ]; then
    echo "❌ FATAL ERROR: visualization-generator-deployment.zip was NOT created."
    exit 1
fi

echo ""
echo "****************************************************************"
echo "Package created: visualization-generator-deployment.zip"
echo "This package includes the Lambda function with numpy 1.24.3."
echo "****************************************************************"
echo ""
echo "✅ Ready for deployment!" 