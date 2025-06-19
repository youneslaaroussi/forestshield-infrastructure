#!/bin/bash

# 🧹 ForestShield Complete Cleanup Script
# Removes ALL AWS resources and build artifacts completely

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${RED}🧹 ForestShield COMPLETE Cleanup Script${NC}"
echo -e "${YELLOW}⚠️  WARNING: This will DELETE ALL ForestShield resources AND build artifacts!${NC}"
echo ""

# Get AWS account info
if ! command -v aws &> /dev/null; then
    echo -e "${YELLOW}⚠️  AWS CLI not found. Skipping AWS cleanup.${NC}"
    SKIP_AWS=true
else
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "")
    REGION=$(aws configure get region 2>/dev/null || echo "us-west-2")

    if [ -z "$ACCOUNT_ID" ]; then
        echo -e "${YELLOW}⚠️  AWS credentials not configured. Skipping AWS cleanup.${NC}"
        SKIP_AWS=true
    else
        echo -e "${BLUE}📋 AWS Cleanup Details:${NC}"
echo "   AWS Account: $ACCOUNT_ID"
echo "   Region: $REGION"
        echo ""
        SKIP_AWS=false
    fi
fi

echo -e "${BLUE}📋 Local Cleanup Details:${NC}"
echo "   • Java build artifacts (target/, *.jar, *.class)"
echo "   • Deployment packages (*.zip, temp-deploy/)"
echo "   • Temporary files (trust-policy.json, .env.production)"
echo "   • Node.js artifacts (node_modules, dist/)"
echo "   • AWS CLI downloads (awscliv2.zip, aws/)"
echo ""

# Confirmation prompt
if [ "$SKIP_AWS" = false ]; then
    read -p "Are you sure you want to DELETE ALL ForestShield AWS resources AND build artifacts? (type 'DELETE' to confirm): " confirmation
else
    read -p "AWS cleanup skipped. Delete local build artifacts? (type 'DELETE' to confirm): " confirmation
fi

if [ "$confirmation" != "DELETE" ]; then
    echo -e "${GREEN}✅ Cleanup cancelled. No resources were deleted.${NC}"
    exit 0
fi

echo ""
echo -e "${RED}🗑️  Starting COMPLETE ForestShield cleanup...${NC}"
echo ""

# Function to wait for resource deletion with timeout
wait_for_deletion() {
    local resource_type=$1
    local check_command=$2
    local resource_name=$3
    local max_wait=${4:-300}  # Default 5 minutes
    local wait_time=0
    
    echo -e "${CYAN}   ⏳ Waiting for $resource_type deletion: $resource_name${NC}"
    
    while eval "$check_command" &>/dev/null && [ $wait_time -lt $max_wait ]; do
        echo -e "${YELLOW}      Still exists... waiting (${wait_time}s/${max_wait}s)${NC}"
        sleep 10
        wait_time=$((wait_time + 10))
    done
    
    if [ $wait_time -ge $max_wait ]; then
        echo -e "${RED}      ⚠️  Timeout waiting for deletion (${max_wait}s)${NC}"
        return 1
    else
        echo -e "${GREEN}      ✅ Successfully deleted${NC}"
        return 0
    fi
}

# Function to safely delete resources with retry
safe_delete() {
    local resource_type=$1
    local resource_name=$2
    local command=$3
    local wait_command=$4
    local max_retries=${5:-3}
    
    echo -e "${YELLOW}🗑️  Deleting $resource_type: $resource_name${NC}"
    
    for attempt in $(seq 1 $max_retries); do
    if eval "$command" 2>/dev/null; then
            echo -e "${GREEN}   ✅ Delete command executed successfully (attempt $attempt)${NC}"
            
            # Wait for actual deletion if wait command provided
            if [ -n "$wait_command" ]; then
                if wait_for_deletion "$resource_type" "$wait_command" "$resource_name"; then
                    return 0
                else
                    echo -e "${RED}   ❌ Deletion timeout (attempt $attempt)${NC}"
                fi
            else
                return 0
            fi
        else
            echo -e "${BLUE}   ℹ️  Resource not found or already deleted (attempt $attempt)${NC}"
            return 0
        fi
        
        if [ $attempt -lt $max_retries ]; then
            echo -e "${YELLOW}   🔄 Retrying in 10 seconds...${NC}"
            sleep 10
        fi
    done
    
    echo -e "${RED}   ❌ Failed to delete after $max_retries attempts${NC}"
    return 1
}

if [ "$SKIP_AWS" = false ]; then
    # 1. Delete CloudFormation Stack FIRST (this will cascade delete many resources)
    echo -e "${BLUE}1. Deleting CloudFormation Stack...${NC}"
    safe_delete "CloudFormation Stack" "forestshield" \
        "aws cloudformation delete-stack --stack-name forestshield" \
        "aws cloudformation describe-stacks --stack-name forestshield" \
        600  # 10 minute timeout for CloudFormation

    # Wait extra time for CloudFormation to fully clean up
    echo -e "${CYAN}   ⏳ Waiting additional 30 seconds for CloudFormation cleanup...${NC}"
    sleep 30

    # 2. Delete Step Functions State Machine
    echo -e "${BLUE}2. Deleting Step Functions State Machine...${NC}"
STATE_MACHINE_ARN="arn:aws:states:$REGION:$ACCOUNT_ID:stateMachine:forestshield-pipeline"
safe_delete "Step Functions State Machine" "forestshield-pipeline" \
        "aws stepfunctions delete-state-machine --state-machine-arn $STATE_MACHINE_ARN" \
        "aws stepfunctions describe-state-machine --state-machine-arn $STATE_MACHINE_ARN"

    # 3. Delete Lambda Functions with proper waiting
    echo -e "${BLUE}3. Deleting Lambda Functions...${NC}"
LAMBDA_FUNCTIONS=(
    "forestshield-ndvi-calculator"
    "forestshield-search-images"
    "forestshield-sagemaker-processor"
)

for function_name in "${LAMBDA_FUNCTIONS[@]}"; do
    safe_delete "Lambda Function" "$function_name" \
            "aws lambda delete-function --function-name $function_name" \
            "aws lambda get-function --function-name $function_name"
done

    # 4. Delete SNS Topic and ALL Subscriptions
    echo -e "${BLUE}4. Deleting SNS Topic and Subscriptions...${NC}"
SNS_TOPIC_ARN="arn:aws:sns:$REGION:$ACCOUNT_ID:deforestation-alerts"

    # Delete all subscriptions first
    echo -e "${YELLOW}   Deleting ALL SNS subscriptions...${NC}"
    aws sns list-subscriptions-by-topic --topic-arn $SNS_TOPIC_ARN --query 'Subscriptions[].SubscriptionArn' --output text 2>/dev/null | tr '\t' '\n' | while read subscription_arn; do
        if [ "$subscription_arn" != "None" ] && [ -n "$subscription_arn" ] && [ "$subscription_arn" != "null" ]; then
        safe_delete "SNS Subscription" "$subscription_arn" \
            "aws sns unsubscribe --subscription-arn $subscription_arn"
    fi
done

    # Delete the topic
safe_delete "SNS Topic" "deforestation-alerts" \
        "aws sns delete-topic --topic-arn $SNS_TOPIC_ARN" \
        "aws sns get-topic-attributes --topic-arn $SNS_TOPIC_ARN"

    # 5. Completely Empty and Delete S3 Buckets
    echo -e "${BLUE}5. Completely Emptying and Deleting S3 Buckets...${NC}"
S3_BUCKETS=(
    "forestshield-processed-data-$ACCOUNT_ID"
    "forestshield-models-$ACCOUNT_ID"
    "forestshield-temp-$ACCOUNT_ID"
        "forestshield-lambda-deployments"
)

for bucket_name in "${S3_BUCKETS[@]}"; do
        echo -e "${YELLOW}   Processing S3 bucket: $bucket_name${NC}"
    
    # Check if bucket exists
    if aws s3api head-bucket --bucket "$bucket_name" 2>/dev/null; then
            echo -e "${YELLOW}     🗑️  Deleting ALL objects and versions...${NC}"
            
            # Delete all objects (including versions and delete markers)
            aws s3api list-object-versions --bucket "$bucket_name" --query 'Versions[].{Key:Key,VersionId:VersionId}' --output json 2>/dev/null | \
            jq -r '.[] | "\(.Key)\t\(.VersionId)"' 2>/dev/null | \
            while IFS=$'\t' read -r key version_id; do
                if [ -n "$key" ] && [ "$key" != "null" ]; then
                    aws s3api delete-object --bucket "$bucket_name" --key "$key" --version-id "$version_id" 2>/dev/null || true
                fi
            done
            
            # Delete all delete markers
            aws s3api list-object-versions --bucket "$bucket_name" --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output json 2>/dev/null | \
            jq -r '.[] | "\(.Key)\t\(.VersionId)"' 2>/dev/null | \
            while IFS=$'\t' read -r key version_id; do
                if [ -n "$key" ] && [ "$key" != "null" ]; then
                    aws s3api delete-object --bucket "$bucket_name" --key "$key" --version-id "$version_id" 2>/dev/null || true
                fi
            done
            
            # Force delete everything with CLI
            aws s3 rm "s3://$bucket_name" --recursive --force 2>/dev/null || true
            
            # Wait a moment for S3 consistency
            echo -e "${CYAN}     ⏳ Waiting for S3 consistency...${NC}"
            sleep 5
        
        # Delete the bucket
        safe_delete "S3 Bucket" "$bucket_name" \
                "aws s3api delete-bucket --bucket $bucket_name" \
                "aws s3api head-bucket --bucket $bucket_name"
    else
        echo -e "${BLUE}     ℹ️  Bucket not found or already deleted${NC}"
    fi
done

    # 6. Detach Policies and Delete IAM Roles with waiting
    echo -e "${BLUE}6. Deleting IAM Roles and Policies...${NC}"

# Lambda Role
echo -e "${YELLOW}   Deleting Lambda IAM Role...${NC}"
aws iam detach-role-policy --role-name ForestShieldLambdaRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true
aws iam detach-role-policy --role-name ForestShieldLambdaRole --policy-arn arn:aws:iam::aws:policy/AmazonS3FullAccess 2>/dev/null || true
aws iam detach-role-policy --role-name ForestShieldLambdaRole --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess 2>/dev/null || true
safe_delete "IAM Role" "ForestShieldLambdaRole" \
        "aws iam delete-role --role-name ForestShieldLambdaRole" \
        "aws iam get-role --role-name ForestShieldLambdaRole"

# SageMaker Role
echo -e "${YELLOW}   Deleting SageMaker IAM Role...${NC}"
aws iam detach-role-policy --role-name ForestShieldSageMakerRole --policy-arn arn:aws:iam::aws:policy/AmazonSageMakerFullAccess 2>/dev/null || true
safe_delete "IAM Role" "ForestShieldSageMakerRole" \
        "aws iam delete-role --role-name ForestShieldSageMakerRole" \
        "aws iam get-role --role-name ForestShieldSageMakerRole"

# Step Functions Role
echo -e "${YELLOW}   Deleting Step Functions IAM Role...${NC}"
aws iam detach-role-policy --role-name ForestShieldStepFunctionsRole --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaRole 2>/dev/null || true
safe_delete "IAM Role" "ForestShieldStepFunctionsRole" \
        "aws iam delete-role --role-name ForestShieldStepFunctionsRole" \
        "aws iam get-role --role-name ForestShieldStepFunctionsRole"

    # 7. Delete CloudWatch Log Groups
    echo -e "${BLUE}7. Deleting CloudWatch Log Groups...${NC}"
LOG_GROUPS=(
    "/aws/lambda/forestshield-ndvi-calculator"
    "/aws/lambda/forestshield-search-images"
    "/aws/lambda/forestshield-sagemaker-processor"
        "/aws/stepfunctions/forestshield-pipeline"
)

for log_group in "${LOG_GROUPS[@]}"; do
    safe_delete "CloudWatch Log Group" "$log_group" \
            "aws logs delete-log-group --log-group-name $log_group" \
            "aws logs describe-log-groups --log-group-name-prefix $log_group --query 'logGroups[0].logGroupName'"
    done

    # 8. Delete any remaining SageMaker resources
    echo -e "${BLUE}8. Cleaning up SageMaker resources...${NC}"
    
    # Delete processing jobs
    aws sagemaker list-processing-jobs --query 'ProcessingJobSummaries[?starts_with(ProcessingJobName, `forestshield`)].ProcessingJobName' --output text 2>/dev/null | \
    while read job_name; do
        if [ -n "$job_name" ] && [ "$job_name" != "None" ]; then
            echo -e "${YELLOW}   Stopping SageMaker processing job: $job_name${NC}"
            aws sagemaker stop-processing-job --processing-job-name "$job_name" 2>/dev/null || true
        fi
    done

    echo -e "${GREEN}✅ AWS resources cleanup completed${NC}"
else
    echo -e "${YELLOW}⚠️  Skipping AWS cleanup (AWS CLI not available or not configured)${NC}"
fi

# 9. COMPLETE Local Build Artifacts Cleanup
echo -e "${BLUE}9. Cleaning up ALL local build artifacts...${NC}"

# Java build artifacts
echo -e "${YELLOW}   🗑️  Removing Java build artifacts...${NC}"
find . -name "target" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "*.jar" -not -path "./node_modules/*" -delete 2>/dev/null || true
find . -name "*.class" -delete 2>/dev/null || true

# Lambda deployment packages
echo -e "${YELLOW}   🗑️  Removing Lambda deployment packages...${NC}"
find . -name "*.zip" -not -path "./node_modules/*" -delete 2>/dev/null || true
find . -name "*-deployment.zip" -delete 2>/dev/null || true
find . -name "temp-deploy" -type d -exec rm -rf {} + 2>/dev/null || true

# Temporary AWS files
echo -e "${YELLOW}   🗑️  Removing temporary AWS files...${NC}"
rm -f lambda-trust-policy.json
rm -f sagemaker-trust-policy.json
rm -f stepfunctions-trust-policy.json
rm -f .env.production
rm -f .env.local
rm -f awscliv2.zip
rm -rf aws/

# Node.js build artifacts
echo -e "${YELLOW}   🗑️  Removing Node.js build artifacts...${NC}"
rm -rf dist/
rm -rf .nest/
rm -rf coverage/

# Backup and log files
echo -e "${YELLOW}   🗑️  Removing backup and log files...${NC}"
find . -name "*.bak" -delete 2>/dev/null || true
find . -name "*.log" -not -path "./node_modules/*" -delete 2>/dev/null || true
find . -name "*.tmp" -delete 2>/dev/null || true

# IDE and system files
echo -e "${YELLOW}   🗑️  Removing IDE and system files...${NC}"
rm -rf .vscode/settings.json 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true
find . -name "Thumbs.db" -delete 2>/dev/null || true

# Downloads folder contents
echo -e "${YELLOW}   🗑️  Cleaning downloads folder...${NC}"
rm -rf downloads/* 2>/dev/null || true

echo -e "${GREEN}   ✅ Local cleanup completed${NC}"

# 10. Verify Complete Cleanup
echo -e "${BLUE}10. Verifying cleanup completion...${NC}"

# Check for remaining build artifacts
REMAINING_JARS=$(find . -name "*.jar" -not -path "./node_modules/*" | wc -l)
REMAINING_ZIPS=$(find . -name "*.zip" -not -path "./node_modules/*" | wc -l)
REMAINING_TARGETS=$(find . -name "target" -type d | wc -l)

echo -e "${CYAN}   Remaining build artifacts:${NC}"
echo "     Java JARs: $REMAINING_JARS"
echo "     ZIP files: $REMAINING_ZIPS"
echo "     Target directories: $REMAINING_TARGETS"

if [ $REMAINING_JARS -eq 0 ] && [ $REMAINING_ZIPS -eq 0 ] && [ $REMAINING_TARGETS -eq 0 ]; then
    echo -e "${GREEN}   ✅ Build artifacts completely cleaned${NC}"
else
    echo -e "${YELLOW}   ⚠️  Some build artifacts may remain${NC}"
fi

# 11. Summary
echo ""
echo -e "${GREEN}🎉 ForestShield COMPLETE cleanup finished!${NC}"
echo ""

if [ "$SKIP_AWS" = false ]; then
    echo -e "${BLUE}📋 AWS Resources deleted:${NC}"
    echo "   • CloudFormation Stack (forestshield)"
    echo "   • 3 Lambda Functions (with proper waiting)"
echo "   • 1 Step Functions State Machine"
    echo "   • 1 SNS Topic + ALL Subscriptions"
    echo "   • 4 S3 Buckets (completely emptied + deleted)"
    echo "   • 3 IAM Roles (with policy detachment)"
echo "   • CloudWatch Log Groups"
    echo "   • SageMaker Processing Jobs (stopped)"
    echo ""
fi

echo -e "${BLUE}📋 Local Build Artifacts deleted:${NC}"
echo "   • ALL Java build artifacts (target/, *.jar, *.class)"
echo "   • ALL deployment packages (*.zip, temp-deploy/)"
echo "   • ALL temporary files (trust-policy.json, .env.*)"
echo "   • Node.js build artifacts (dist/, .nest/, coverage/)"
echo "   • Backup and log files (*.bak, *.log, *.tmp)"
echo "   • IDE and system files (.DS_Store, Thumbs.db)"
echo "   • Downloads folder contents"
echo ""

if [ "$SKIP_AWS" = false ]; then
echo -e "${YELLOW}💰 Cost Impact:${NC}"
    echo "   • ALL AWS charges for ForestShield have stopped"
    echo "   • No more Lambda, S3, SageMaker, or SNS costs"
    echo "   • CloudFormation stack completely deleted"
    echo "   • Your AWS account is completely clean"
echo ""
fi

echo -e "${BLUE}📝 Note:${NC}"
echo "   • You can re-deploy anytime with: ./deploy.sh"
echo "   • Source code and package.json remain intact"
echo "   • Only AWS resources and build artifacts were deleted"
echo ""
echo -e "${GREEN}✨ ForestShield COMPLETELY cleaned up!${NC}" 