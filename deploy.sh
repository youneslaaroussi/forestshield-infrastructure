#!/bin/bash

# 🌳 ForestShield AWS Deployment Script
# Complete serverless infrastructure setup for deforestation detection

set -e

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up temporary files..."
    rm -f lambda-trust-policy.json 
    rm -f sagemaker-trust-policy.json 
    rm -f stepfunctions-trust-policy.json
    # Clean up any backup files from sed
    find . -name "*.bak" -type f -delete 2>/dev/null || true
}

# Set trap to cleanup on exit (both success and failure)
trap cleanup EXIT

echo "🚀 Starting ForestShield AWS Deployment..."

# Check AWS CLI and credentials
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

# Get AWS account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=${AWS_REGION:-us-west-2}

echo "✅ AWS Account: $ACCOUNT_ID"
echo "✅ Region: $REGION"

# Create S3 buckets
echo "📦 Creating S3 buckets..."
aws s3 mb s3://forestshield-processed-data-$ACCOUNT_ID || echo "Bucket already exists"
aws s3 mb s3://forestshield-models-$ACCOUNT_ID || echo "Bucket already exists"
aws s3 mb s3://forestshield-temp-$ACCOUNT_ID || echo "Bucket already exists"

# Create IAM roles
echo "🔐 Creating IAM roles..."

# Lambda execution role
cat > lambda-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name ForestShieldLambdaRole \
  --assume-role-policy-document file://lambda-trust-policy.json || echo "Role already exists"

# Attach policies to Lambda role
aws iam attach-role-policy \
  --role-name ForestShieldLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam attach-role-policy \
  --role-name ForestShieldLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess

aws iam attach-role-policy \
  --role-name ForestShieldLambdaRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess

# SageMaker execution role
cat > sagemaker-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "sagemaker.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name ForestShieldSageMakerRole \
  --assume-role-policy-document file://sagemaker-trust-policy.json || echo "Role already exists"

aws iam attach-role-policy \
  --role-name ForestShieldSageMakerRole \
  --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess

# Step Functions execution role
cat > stepfunctions-trust-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "states.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
EOF

aws iam create-role \
  --role-name ForestShieldStepFunctionsRole \
  --assume-role-policy-document file://stepfunctions-trust-policy.json || echo "Role already exists"

aws iam attach-role-policy \
  --role-name ForestShieldStepFunctionsRole \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaRole

# Wait for roles to propagate
echo "⏳ Waiting for IAM roles to propagate..."
sleep 10

# Build Java Lambda functions
echo "🔨 Building Java Lambda functions..."
cd lambda-functions
chmod +x build-all.sh
./build-all.sh

# Function to deploy Lambda function
deploy_lambda_function() {
    local function_name=$1
    local handler=$2
    local jar_file=$3
    local timeout=$4
    local memory=$5
    local env_vars=$6
    local layers=$7
    local jar_size_bytes
    local jar_size_mb
    local max_direct_upload_mb
    local create_code_param
    local update_code_param

    echo "🚀 Deploying $function_name..."

    # Check JAR file size to determine deployment method
    jar_size_bytes=$(stat -c%s "$jar_file")
    jar_size_mb=$((jar_size_bytes / 1024 / 1024))
    max_direct_upload_mb=10 # Force S3 for anything large. Direct uploads are flaky.

    if [ $jar_size_mb -gt $max_direct_upload_mb ]; then
        echo "   JAR size is ${jar_size_mb}MB (large). Deploying via S3."
        
        local deploy_bucket="forestshield-lambda-deployments-$ACCOUNT_ID"
        local s3_key="$function_name-$(basename $jar_file)"

        echo "   Uploading to s3://$deploy_bucket/$s3_key..."
        aws s3 cp "$jar_file" "s3://$deploy_bucket/$s3_key" --only-show-errors
        
        # Parameters for create-function and update-function-code are different
        create_code_param="--code S3Bucket=$deploy_bucket,S3Key=$s3_key"
        update_code_param="--s3-bucket $deploy_bucket --s3-key $s3_key"
    else
        echo "   JAR size is ${jar_size_mb}MB (small). Deploying directly."
        create_code_param="--zip-file fileb://$jar_file"
        update_code_param="--zip-file fileb://$jar_file"
    fi
    
    # Check if function exists
    if aws lambda get-function --function-name "$function_name" &>/dev/null; then
        echo "   Function exists, updating code..."
        aws lambda update-function-code \
            --function-name "$function_name" \
            $update_code_param
        
        echo "   Waiting for code update to complete..."
        aws lambda wait function-updated --function-name "$function_name"

        if [ ! -z "$env_vars" ]; then
            echo "   Updating environment variables..."
            aws lambda update-function-configuration \
                --function-name "$function_name" \
                --environment "Variables=$env_vars"
            
            echo "   Waiting for environment variables update to complete..."
            aws lambda wait function-updated --function-name "$function_name"
        fi
        
        if [ ! -z "$layers" ]; then
            echo "   Updating layers..."
            aws lambda update-function-configuration \
                --function-name "$function_name" \
                --layers $layers
            
            echo "   Waiting for layers update to complete..."
            aws lambda wait function-updated --function-name "$function_name"
        fi
    else
        echo "   Creating new function..."
        local env_config=""
        if [ ! -z "$env_vars" ]; then
            env_config="--environment Variables=$env_vars"
        fi
        
        local layers_config=""
        if [ ! -z "$layers" ]; then
            layers_config="--layers $layers"
        fi
        
        aws lambda create-function \
            --function-name "$function_name" \
            --runtime java17 \
            --role "$LAMBDA_ROLE_ARN" \
            --handler "$handler" \
            $create_code_param \
            --timeout "$timeout" \
            --memory-size "$memory" \
            --snap-start ApplyOn=PublishedVersions \
            $env_config \
            $layers_config
    fi
}

# Deploy Lambda functions
echo "🚀 Deploying Lambda functions..."
LAMBDA_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/ForestShieldLambdaRole"

# Deploy Vegetation Analyzer (Python)
echo "🐍 Deploying Python Vegetation Analyzer..."
cd vegetation-analyzer

# Check if deployment package exists
if [ ! -f "vegetation-analyzer-deployment.zip" ]; then
    echo "❌ vegetation-analyzer-deployment.zip not found. Run build script first."
    exit 1
fi

# Deploy Python Lambda function
deploy_lambda_function \
    "forestshield-vegetation-analyzer" \
    "handler.lambda_handler" \
    "vegetation-analyzer-deployment.zip" \
    300 \
    2048 \
    "{GDAL_DATA=/opt/share/gdal,PROJ_LIB=/opt/share/proj,PROCESSED_DATA_BUCKET=forestshield-processed-data-$ACCOUNT_ID,TEMP_BUCKET=forestshield-temp-$ACCOUNT_ID}" \
    "arn:aws:lambda:us-west-2:524387336408:layer:gdal38:4"

# Deploy Search Images
cd ../search-images
deploy_lambda_function \
    "forestshield-search-images" \
    "com.forestshield.SearchImagesHandler::handleRequest" \
    "target/search-images-1.0.0.jar" \
    60 \
    512

# Deploy SageMaker Processor
cd ../sagemaker-processor
deploy_lambda_function \
    "forestshield-sagemaker-processor" \
    "com.forestshield.SageMakerProcessorHandler::handleRequest" \
    "target/sagemaker-processor-1.0.0.jar" \
    300 \
    1024

# Create SNS topic for alerts
echo "📢 Creating SNS topic for deforestation alerts..."
SNS_TOPIC_ARN=$(aws sns create-topic --name deforestation-alerts --query TopicArn --output text)
echo "✅ SNS Topic ARN: $SNS_TOPIC_ARN"

# Create Step Functions state machine
echo "🔄 Creating Step Functions workflow..."
cd ../step-functions
STEP_FUNCTIONS_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/ForestShieldStepFunctionsRole"

# Update the state machine definition with actual ARNs
sed -i.bak \
  -e "s/ACCOUNT_ID/$ACCOUNT_ID/g" \
  -e "s/REGION/$REGION/g" \
  deforestation-detection-workflow.json

aws stepfunctions create-state-machine \
  --name forestshield-pipeline \
  --definition file://deforestation-detection-workflow.json \
  --role-arn $STEP_FUNCTIONS_ROLE_ARN || echo "State machine already exists"

# Get final ARNs
STEP_FUNCTION_ARN=$(aws stepfunctions describe-state-machine --state-machine-arn "arn:aws:states:$REGION:$ACCOUNT_ID:stateMachine:forestshield-pipeline" --query stateMachineArn --output text)

# Create environment file for NestJS
cd ../../
cat > .env.production << EOF
# 🌳 ForestShield Production Environment Variables
# Generated by deployment script on $(date)

# AWS Configuration
AWS_REGION=$REGION
AWS_ACCOUNT_ID=$ACCOUNT_ID

# S3 Buckets
FORESTSHIELD_DATA_BUCKET=forestshield-processed-data-$ACCOUNT_ID
FORESTSHIELD_MODELS_BUCKET=forestshield-models-$ACCOUNT_ID
FORESTSHIELD_TEMP_BUCKET=forestshield-temp-$ACCOUNT_ID

# Lambda Function ARNs
LAMBDA_VEGETATION_ANALYZER_ARN=arn:aws:lambda:$REGION:$ACCOUNT_ID:function:forestshield-vegetation-analyzer
LAMBDA_SEARCH_IMAGES_ARN=arn:aws:lambda:$REGION:$ACCOUNT_ID:function:forestshield-search-images
LAMBDA_SAGEMAKER_PROCESSOR_ARN=arn:aws:lambda:$REGION:$ACCOUNT_ID:function:forestshield-sagemaker-processor

# SageMaker
SAGEMAKER_EXECUTION_ROLE_ARN=arn:aws:iam::$ACCOUNT_ID:role/ForestShieldSageMakerRole

# Step Functions
STEP_FUNCTIONS_STATE_MACHINE_ARN=$STEP_FUNCTION_ARN

# SNS for Alerts
SNS_DEFORESTATION_ALERTS_ARN=$SNS_TOPIC_ARN

# Production Mode
NODE_ENV=production
USE_REAL_AWS=true
EOF

echo ""
echo "🎉 ForestShield AWS deployment completed successfully!"
echo ""
echo "📋 Next Steps:"
echo "1. Copy .env.production to your server"
echo "2. Subscribe to SNS topic for alerts: $SNS_TOPIC_ARN"
echo "3. Test the API endpoints"
echo "4. Monitor CloudWatch logs"
echo ""
echo "🔗 Useful ARNs:"
echo "   Step Functions: $STEP_FUNCTION_ARN"
echo "   SNS Topic: $SNS_TOPIC_ARN"
echo ""
echo "💰 Estimated daily cost: < $5"
echo "📊 Monitor usage in AWS Cost Explorer" 