# 🌳 ForestShield CloudFormation Deployment Guide

Modern infrastructure as code deployment for the ForestShield deforestation detection system.

## 🚀 Quick Start

### Prerequisites

- AWS CLI v2+ installed and configured
- Docker installed (for Python Lambda builds)
- Java 17+ and Maven (for Java Lambda builds)
- `jq` for JSON processing (optional but recommended)

### Environment Setup

1. **Configure AWS CLI:**
```bash
aws configure
# Enter your AWS Access Key ID, Secret Access Key, and Region
```

2. **Set environment variables (optional):**
```bash
# Create .env file
cat > .env << EOF
ENVIRONMENT=dev
ALERT_EMAIL=your-email@domain.com
FORESTSHIELD_API_BASE_URL=https://api.forestshieldapp.com
STACK_NAME=forestshield-infratructure
AWS_REGION=us-west-2
EOF
```

### Deployment

```bash
# Make deployment script executable
chmod +x deploy-cloudformation.sh

# Deploy the stack
./deploy-cloudformation.sh
```

That's it! The script will:
- Build all Lambda functions
- Upload deployment packages to S3
- Deploy the CloudFormation stack
- Configure all AWS resources
- Provide you with deployment details

## 📋 What Gets Deployed

### S3 Buckets
- `forestshield-processed-data-{account-id}` - Processed satellite data
- `forestshield-models-{account-id}` - ML models and training data
- `forestshield-temp-{account-id}` - Temporary files (7-day lifecycle)
- `forestshield-lambda-deployments-{account-id}` - Lambda deployment packages

### Lambda Functions
- `forestshield-vegetation-analyzer` - Python/GDAL satellite image analysis
- `forestshield-results-consolidator` - Results aggregation and API updates
- `forestshield-model-manager` - ML model lifecycle management
- `forestshield-visualization-generator` - Chart and map generation
- `forestshield-k-selector` - Dynamic K-means cluster optimization
- `forestshield-search-images` - Java-based satellite image search
- `forestshield-sagemaker-processor` - SageMaker integration

### Step Functions
- `forestshield-pipeline` - Complete deforestation detection workflow

### IAM Roles
- `ForestShieldLambdaRole` - Lambda execution with S3/SageMaker access
- `ForestShieldSageMakerRole` - SageMaker training/inference role
- `ForestShieldStepFunctionsRole` - Step Functions orchestration role

### SNS
- `forestshield-deforestation-alerts` - Alert notifications topic

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STACK_NAME` | CloudFormation stack name | `forestshield-infratructure` |
| `ENVIRONMENT` | Environment (dev/staging/prod) | `dev` |
| `AWS_REGION` | AWS region | `us-west-2` |
| `ALERT_EMAIL` | Email for alerts | None |
| `FORESTSHIELD_API_BASE_URL` | API base URL | `https://api.forestshieldapp.com` |

### CloudFormation Parameters

You can also pass parameters directly to CloudFormation:

```bash
aws cloudformation update-stack \
  --stack-name forestshield-infratructure \
  --template-body file://cloudformation.yaml \
  --parameters ParameterKey=AlertEmail,ParameterValue=alerts@company.com \
               ParameterKey=Environment,ParameterValue=prod \
  --capabilities CAPABILITY_NAMED_IAM
```

## 🔄 Stack Management

### Check Stack Status
```bash
./rollback.sh status
```

### View Recent Events
```bash
./rollback.sh events
```

### Cancel Failed Updates
```bash
./rollback.sh cancel
```

### View Logs
```bash
./rollback.sh logs
```

### Update Stack
```bash
# Modify cloudformation.yaml or environment variables, then:
./deploy-cloudformation.sh
```

### Rollback to Previous Version
```bash
aws cloudformation continue-update-rollback \
  --stack-name forestshield-infratructure
```

## 🗑️ Cleanup

### Delete Stack
```bash
./rollback.sh delete
```

⚠️ **Warning:** This will delete all resources and data. S3 buckets are emptied automatically.

### Manual Cleanup (if needed)
```bash
# Get account ID
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

# Empty S3 buckets manually
aws s3 rm s3://forestshield-processed-data-$ACCOUNT_ID --recursive
aws s3 rm s3://forestshield-models-$ACCOUNT_ID --recursive
aws s3 rm s3://forestshield-temp-$ACCOUNT_ID --recursive
aws s3 rm s3://forestshield-lambda-deployments-$ACCOUNT_ID --recursive

# Delete CloudFormation stack
aws cloudformation delete-stack --stack-name forestshield-infratructure
```

## 🚨 Alert Configuration

### Risk Levels
- **HIGH RISK**: Vegetation < 30% AND NDVI < 0.3
- **MEDIUM RISK**: Vegetation < 50% AND NDVI < 0.5
- **INFO**: Normal vegetation levels

### Email Alerts
Set the `ALERT_EMAIL` environment variable to receive notifications:

```bash
export ALERT_EMAIL=your-email@domain.com
./deploy-cloudformation.sh
```

### SNS Subscriptions Management
```bash
# List subscriptions
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-west-2:ACCOUNT_ID:forestshield-deforestation-alerts

# Add email subscription
aws sns subscribe \
  --topic-arn arn:aws:sns:us-west-2:ACCOUNT_ID:forestshield-deforestation-alerts \
  --protocol email \
  --notification-endpoint new-email@domain.com

# Remove subscription
aws sns unsubscribe --subscription-arn SUBSCRIPTION_ARN
```

## 🧪 Testing

### Test the Pipeline
```bash
# Get Step Function ARN from stack outputs
STEP_FUNCTION_ARN=$(aws cloudformation describe-stacks \
  --stack-name forestshield-infratructure \
  --query 'Stacks[0].Outputs[?OutputKey==`StepFunctionArn`].OutputValue' \
  --output text)

# Start execution
aws stepfunctions start-execution \
  --state-machine-arn $STEP_FUNCTION_ARN \
  --input '{
    "region": "us-west-2",
    "date": "2024-01-01",
    "coordinates": {
      "lat": -10.0,
      "lon": -60.0
    }
  }'
```

### Test Individual Lambda Functions
```bash
# Test vegetation analyzer
aws lambda invoke \
  --function-name forestshield-vegetation-analyzer \
  --payload '{"test": true}' \
  response.json

# View response
cat response.json
```

### Monitor Execution
```bash
# List executions
aws stepfunctions list-executions \
  --state-machine-arn $STEP_FUNCTION_ARN

# Get execution details
aws stepfunctions describe-execution \
  --execution-arn EXECUTION_ARN
```

## 📊 Monitoring

### CloudWatch Dashboards
Access pre-configured dashboards:
- Lambda performance metrics
- Step Functions execution status
- S3 bucket usage
- Cost tracking

### Log Groups
- `/aws/lambda/forestshield-vegetation-analyzer`
- `/aws/lambda/forestshield-results-consolidator`
- `/aws/lambda/forestshield-model-manager`
- `/aws/lambda/forestshield-visualization-generator`
- `/aws/lambda/forestshield-k-selector`
- `/aws/lambda/forestshield-search-images`
- `/aws/lambda/forestshield-sagemaker-processor`
- `/aws/stepfunctions/forestshield-pipeline`

### Real-time Monitoring
```bash
# Follow logs in real-time
aws logs tail /aws/lambda/forestshield-vegetation-analyzer --follow

# View Step Functions execution
aws stepfunctions describe-execution --execution-arn EXECUTION_ARN
```

## 🔧 Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check Docker is running (for Python builds)
docker info

# Check Java/Maven version
java -version
mvn -version
```

#### Stack Update Failures
```bash
# Check stack events
./rollback.sh events

# Cancel failed update
./rollback.sh cancel

# Check IAM permissions
aws iam get-role --role-name ForestShieldLambdaRole
```

#### Lambda Function Errors
```bash
# Check function logs
aws logs tail /aws/lambda/forestshield-vegetation-analyzer

# Check function configuration
aws lambda get-function --function-name forestshield-vegetation-analyzer
```

### Debug Mode
Set debug environment variables:
```bash
export DEBUG=true
export VERBOSE=true
./deploy-cloudformation.sh
```

## 💰 Cost Optimization

### Cost Monitoring
- S3 Intelligent Tiering enabled
- Lambda functions use ARM64 for cost efficiency
- Temporary files auto-deleted after 7 days
- CloudWatch log retention set to 7 days (configurable)

### Estimated Monthly Costs (us-west-2)
- **Development**: $10-50/month
- **Production**: $50-200/month (depends on usage)

### Cost Breakdown
- Lambda executions: $0.20 per 1M requests
- S3 storage: $0.023 per GB
- Step Functions: $0.025 per 1000 transitions
- CloudWatch: $0.50 per GB ingested

## 🔒 Security

### IAM Best Practices
- Least privilege access
- Role-based permissions
- No hardcoded credentials
- Cross-service trust policies

### Data Encryption
- S3 buckets encrypted at rest (AES-256)
- Lambda environment variables encrypted
- CloudWatch logs encrypted

### Network Security
- S3 public access blocked
- Lambda functions in VPC (optional)
- API Gateway with rate limiting

## 🚀 Advanced Configuration

### Multi-Environment Setup
```bash
# Deploy to different environments
ENVIRONMENT=staging STACK_NAME=forestshield-staging ./deploy-cloudformation.sh
ENVIRONMENT=prod STACK_NAME=forestshield-prod ./deploy-cloudformation.sh
```

### Custom Regions
```bash
# Deploy to different regions
AWS_REGION=eu-west-1 ./deploy-cloudformation.sh
AWS_REGION=ap-southeast-2 ./deploy-cloudformation.sh
```

### Blue/Green Deployments
```bash
# Create blue stack
STACK_NAME=forestshield-blue ./deploy-cloudformation.sh

# Test blue stack
# Switch traffic to blue stack
# Delete green stack when confident
```

---

For more information, see the [ForestShield API Documentation](API_DOCUMENTATION.md) and [System Architecture](README.md). 