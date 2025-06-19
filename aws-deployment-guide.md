# 🚀 AWS Deployment Guide for ForestShield

## Environment Variables Required for Production

### Required AWS Credentials
```bash
# AWS Account Access
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=123456789012

# S3 Buckets
FORESTSHIELD_DATA_BUCKET=forestshield-processed-data
FORESTSHIELD_MODELS_BUCKET=forestshield-models
FORESTSHIELD_TEMP_BUCKET=forestshield-temp

# Lambda Function ARNs (after deployment)
LAMBDA_NDVI_CALCULATOR_ARN=arn:aws:lambda:us-west-2:123456789012:function:forestshield-ndvi-calculator
LAMBDA_SEARCH_IMAGES_ARN=arn:aws:lambda:us-west-2:123456789012:function:forestshield-search-images
LAMBDA_CHANGE_DETECTOR_ARN=arn:aws:lambda:us-west-2:123456789012:function:forestshield-change-detector

# SageMaker
SAGEMAKER_EXECUTION_ROLE_ARN=arn:aws:iam::123456789012:role/SageMakerExecutionRole

# Step Functions
STEP_FUNCTIONS_STATE_MACHINE_ARN=arn:aws:states:us-west-2:123456789012:stateMachine:forestshield-pipeline

# SNS for Alerts
SNS_DEFORESTATION_ALERTS_ARN=arn:aws:sns:us-west-2:123456789012:deforestation-alerts
```

## Deployment Steps

### 1. Create S3 Buckets
```bash
aws s3 mb s3://forestshield-processed-data
aws s3 mb s3://forestshield-models  
aws s3 mb s3://forestshield-temp
```

### 2. Deploy Lambda Functions
```bash
# Package NDVI calculator
zip -r ndvi-calculator.zip lambda_function.py requirements.txt
aws lambda create-function \
  --function-name forestshield-ndvi-calculator \
  --runtime python3.9 \
  --role arn:aws:iam::123456789012:role/lambda-execution-role \
  --handler lambda_function.lambda_handler \
  --zip-file fileb://ndvi-calculator.zip
```

### 3. Create SageMaker Processing Job
```bash
aws sagemaker create-processing-job \
  --processing-job-name forestshield-kmeans-clustering \
  --role-arn arn:aws:iam::123456789012:role/SageMakerExecutionRole \
  --app-specification ImageUri=683313688378.dkr.ecr.us-west-2.amazonaws.com/sagemaker-scikit-learn:0.23-1-cpu-py3
```

### 4. Create Step Functions State Machine
```bash
aws stepfunctions create-state-machine \
  --name forestshield-pipeline \
  --definition file://step-functions-definition.json \
  --role-arn arn:aws:iam::123456789012:role/StepFunctionsExecutionRole
```

## Current Status: Simulation vs Real AWS

### ✅ What Works Now (Simulated)
- API endpoints return realistic data
- Architecture is properly designed
- Code is ready for deployment
- Mock processing shows expected results

### ❌ What Needs Real AWS Setup
- Actual Lambda function deployment
- Real S3 bucket creation
- SageMaker job execution
- Step Functions workflow execution
- SNS alert notifications

## Quick Production Switch

To switch from simulation to real AWS, update the controller:

```typescript
// Current: Using simulation
return awsLambdaService.simulateNDVIProcessing(request);

// Production: Using real AWS Lambda
const lambdaClient = new LambdaClient({ region: 'us-west-2' });
const result = await lambdaClient.send(new InvokeCommand({
  FunctionName: process.env.LAMBDA_NDVI_CALCULATOR_ARN,
  Payload: JSON.stringify(request)
}));
```

## Cost Estimate for Demo
- Lambda: ~$0.01 per request
- SageMaker: ~$0.50 per processing job  
- S3: ~$0.10 per GB storage
- Step Functions: ~$0.025 per 1000 state transitions

**Total demo cost: < $5/day** 