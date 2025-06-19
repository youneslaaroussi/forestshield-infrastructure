#!/bin/bash

echo "Building GDAL Lambda function with Python bindings..."

# Build the Docker image
docker build --tag gdal-lambda-package:latest .

# Create a container and extract the package
# The package will be placed in the parent directory
docker run --name gdal-lambda-temp -d gdal-lambda-package:latest sleep 10
docker cp gdal-lambda-temp:/tmp/package.zip ../gdal-test-function.zip
docker stop gdal-lambda-temp
docker rm gdal-lambda-temp

echo ""
echo "****************************************************************"
echo "Package created at: ../gdal-test-function.zip"
echo "This package includes the Lambda function and GDAL Python bindings."
echo "****************************************************************"
echo ""
echo "Now, run this command from this directory:"
echo "aws lambda update-function-code --function-name gdal-test-function --zip-file fileb://../gdal-test-function.zip"
echo ""
echo "OR, go to the parent directory (cd ..) and run:"
echo "aws lambda update-function-code --function-name gdal-test-function --zip-file fileb://gdal-test-function.zip" 