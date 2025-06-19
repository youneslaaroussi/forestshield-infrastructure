#!/bin/bash

# Exit immediately if a command exits with a non-zero status.
set -e

echo "Building Vegetation Analyzer Lambda function with GDAL Python bindings..."

# Build the Docker image
docker build --tag vegetation-analyzer-package:latest .

# Create a container and extract the package
# Using a temporary name with a timestamp to avoid conflicts
CONTAINER_NAME="vegetation-analyzer-temp-$(date +%s)"
trap "docker rm -f $CONTAINER_NAME > /dev/null 2>&1" EXIT # Ensure cleanup

docker run --name $CONTAINER_NAME -d vegetation-analyzer-package:latest sleep 10
docker cp $CONTAINER_NAME:/tmp/package.zip ./vegetation-analyzer-deployment.zip

# Final check to ensure the file exists before declaring victory
if [ ! -f "vegetation-analyzer-deployment.zip" ]; then
    echo "❌ FATAL ERROR: vegetation-analyzer-deployment.zip was NOT created."
    exit 1
fi

echo ""
echo "****************************************************************"
echo "Package created: vegetation-analyzer-deployment.zip"
echo "This package includes the Lambda function and GDAL Python bindings."
echo "****************************************************************"
echo ""
echo "Ready to deploy with the lambgeo layer!" 