#!/bin/bash

# 🔧 ForestShield Deployment Configuration
# Common variables and AWS setup validation

set -e

# Default Configuration
export STACK_NAME=${STACK_NAME:-forestshield-infratructure}
export REGION=${AWS_REGION:-us-west-2}
export TEMPLATE_FILE="cloudformation.yaml"
export ENVIRONMENT=${ENVIRONMENT:-dev}
export ECR_REPO_NAME="forestshield-api"
export DOCKERFILE_PATH="."

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export NC='\033[0m' # No Color

# Utility functions
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Load environment variables from .env file if it exists (skip AWS credentials)
load_env() {
    if [ -f ".env" ]; then
        log_info "Loading environment variables from .env file (excluding AWS credentials)"
        export $(grep -v '^#' .env | grep -v '^AWS_ACCESS_KEY_ID' | grep -v '^AWS_SECRET_ACCESS_KEY' | grep -v '^AWS_REGION' | xargs)
        log_success "Environment variables loaded (AWS credentials skipped)"
    else
        log_warning "No .env file found. Using system environment variables only."
    fi
}

# Check AWS CLI and credentials
validate_aws() {
    log_info "Validating AWS setup..."
    
    if ! command -v aws &> /dev/null; then
        log_error "AWS CLI not found. Please install AWS CLI first."
        exit 1
    fi

    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        log_error "AWS credentials not configured. Please run 'aws configure' first."
        exit 1
    fi

    # Get AWS account ID (strip any carriage returns)
    export ACCOUNT_ID=$(aws sts get-caller-identity --query "Account" --output text | tr -d '\r\n')
    
    log_success "AWS Account: $ACCOUNT_ID"
    log_success "Region: $REGION"
}

# Derived variables (set after ACCOUNT_ID is available)
set_derived_vars() {
    export LAMBDA_DEPLOY_BUCKET="forestshield-lambda-deployments-$ACCOUNT_ID"
    export TEMPLATE_BUCKET="forestshield-cfn-templates-$ACCOUNT_ID"
    export ECR_REPOSITORY_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO_NAME}"
}

# Initialize configuration
init_config() {
    load_env
    validate_aws
    set_derived_vars
} 