#!/bin/bash

# ForestShield Model Manager Build & Push Script
# Builds the Docker container and pushes it to ECR for Lambda deployment.

set -e

# Configuration
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text --no-cli-pager)
AWS_REGION=${AWS_REGION:-"us-west-2"}
ECR_REPOSITORY_NAME="forestshield/model-manager"
IMAGE_TAG="latest"

# Full ECR image URI
ECR_IMAGE_URI="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY_NAME}:${IMAGE_TAG}"

echo "🔄 Building and pushing Model Manager to ECR..."
echo "   Region: ${AWS_REGION}"
echo "   Account ID: ${AWS_ACCOUNT_ID}"
echo "   Image URI: ${ECR_IMAGE_URI}"

# 1. Create ECR repository if it doesn't exist
echo "🏗️ Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names ${ECR_REPOSITORY_NAME} --region ${AWS_REGION} > /dev/null 2>&1 || {
    echo "📦 Creating ECR repository: ${ECR_REPOSITORY_NAME}"
    aws ecr create-repository \
        --repository-name ${ECR_REPOSITORY_NAME} \
        --image-scanning-configuration scanOnPush=true \
        --image-tag-mutability MUTABLE \
        --region ${AWS_REGION} > /dev/null
    echo "✅ ECR repository created successfully"
}

# 2. Authenticate Docker to the Amazon ECR registry
echo "🔐 Authenticating with ECR..."
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# 3. Build the Docker image
echo "🐳 Building Docker image..."
docker build -t ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} .

# 4. Tag the Docker image for ECR
echo "🏷️ Tagging image for ECR..."
docker tag ${ECR_REPOSITORY_NAME}:${IMAGE_TAG} ${ECR_IMAGE_URI}

# 5. Push the image to ECR
echo "🚀 Pushing image to ECR..."
docker push ${ECR_IMAGE_URI}

echo ""
echo "****************************************************************"
echo "✅ Model Manager image pushed successfully!"
echo "📍 ECR URI: ${ECR_IMAGE_URI}"
echo "🚀 You can now deploy the CloudFormation stack."
echo "****************************************************************"
echo "" 