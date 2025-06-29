#!/bin/bash

# 🧹 ForestShield Nuclear Cleanup Script
# Deletes EVERYTHING related to ForestShield with proper dependency handling

set -e

source "$(dirname "$0")/config.sh"

show_help() {
    echo "🧹 ForestShield Nuclear Cleanup"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -s, --stack-only        Delete only CloudFormation stack"
    echo "  -l, --lambdas-only      Delete only Lambda functions"
    echo "  -e, --ecr-only          Delete only ECR repositories"
    echo "  -b, --buckets-only      Delete only S3 buckets"
    echo "  -f, --force             Skip confirmations (DANGEROUS)"
    echo "  -d, --dry-run           Show what would be deleted without doing it"
    echo "  --nuclear               Delete EVERYTHING (requires --force)"
    echo ""
    echo "Examples:"
    echo "  $0 -d                   # Dry run - scan ALL resources, show what would be deleted"
    echo "  $0 -s                   # Delete only CloudFormation stack"
    echo "  $0 -f                   # Delete ALL found resources (with confirmations)"
    echo "  $0 --nuclear -f         # Delete everything without confirmation"
    echo ""
    echo "⚠️  WARNING: This script will permanently delete AWS resources!"
}

confirm_deletion() {
    local resource_type=$1
    local force=$2
    
    if [ "$force" = true ]; then
        return 0
    fi
    
    echo ""
    log_warning "About to delete $resource_type"
    read -p "Are you sure? Type 'DELETE' to confirm: " confirm
    
    if [ "$confirm" != "DELETE" ]; then
        log_info "Operation cancelled"
        return 1
    fi
    return 0
}

# Clean up CloudFormation stack with all edge cases
cleanup_cloudformation_stack() {
    local dry_run=$1
    local force=$2
    
    log_info "Checking CloudFormation stack: $STACK_NAME"
    
    local status=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")
    
    if [ "$status" = "DOES_NOT_EXIST" ]; then
        log_info "CloudFormation stack does not exist"
        return 0
    fi
    
    log_info "Stack status: $status"
    
    if [ "$dry_run" = true ]; then
        echo "  [DRY RUN] Would delete CloudFormation stack: $STACK_NAME"
        return 0
    fi
    
    if ! confirm_deletion "CloudFormation stack ($STACK_NAME)" "$force"; then
        return 0
    fi
    
    # Handle problematic states
    case $status in
        "UPDATE_ROLLBACK_FAILED"|"ROLLBACK_FAILED")
            log_warning "Stack is in ROLLBACK_FAILED state - attempting manual cleanup..."
            
            # First, try to delete stuck resources manually
            log_info "Attempting to delete stuck Redis cluster..."
            local redis_cluster_id=$(aws cloudformation describe-stack-resources \
                --stack-name "$STACK_NAME" \
                --region "$REGION" \
                --query "StackResources[?LogicalResourceId=='RedisCluster'].PhysicalResourceId" \
                --output text 2>/dev/null || echo "")
            
            if [ ! -z "$redis_cluster_id" ] && [ "$redis_cluster_id" != "None" ]; then
                log_info "Found Redis cluster: $redis_cluster_id"
                # Force delete the Redis cluster
                aws elasticache delete-replication-group \
                    --replication-group-id "$redis_cluster_id" \
                    --region "$REGION" 2>/dev/null || true
                
                # Wait a bit for the deletion to start
                sleep 10
            fi
            
            # Try to continue rollback
            log_info "Attempting to continue rollback..."
            aws cloudformation continue-update-rollback \
                --stack-name "$STACK_NAME" \
                --region "$REGION" \
                --resources-to-skip "RedisCluster" 2>/dev/null || true
            
            # Wait for rollback to complete
            log_info "Waiting for rollback to complete..."
            aws cloudformation wait stack-rollback-complete \
                --stack-name "$STACK_NAME" \
                --region "$REGION" 2>/dev/null || true
            
            # Check status again
            local new_status=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
                --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST")
            
            if [[ "$new_status" == *"ROLLBACK_FAILED"* ]]; then
                log_warning "Rollback still failed - trying to delete stack directly..."
                # Sometimes you need to skip resources that are stuck
                aws cloudformation delete-stack \
                    --stack-name "$STACK_NAME" \
                    --region "$REGION" 2>/dev/null || true
                return 0
            fi
            ;;
    esac
    
    # Disable termination protection
    log_info "Disabling termination protection..."
    aws cloudformation update-termination-protection \
        --stack-name "$STACK_NAME" \
        --no-enable-termination-protection \
        --region "$REGION" 2>/dev/null || true
    
    # Delete the stack
    log_info "Deleting CloudFormation stack..."
    aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
    
    log_info "Waiting for stack deletion to complete..."
    aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION" || true
    
    log_success "CloudFormation stack deleted"
}

# Clean up S3 buckets (empty them first)
cleanup_s3_buckets() {
    local dry_run=$1
    local force=$2
    
    log_info "Finding ForestShield S3 buckets..."
    
    local buckets=(
        "forestshield-processed-data-$ACCOUNT_ID"
        "forestshield-lambda-deployments-$ACCOUNT_ID"
        "forestshield-models-$ACCOUNT_ID"
        "forestshield-temp-$ACCOUNT_ID"
        "forestshield-cfn-templates-$ACCOUNT_ID"
    )
    
    for bucket in "${buckets[@]}"; do
        if aws s3api head-bucket --bucket "$bucket" --region "$REGION" 2>/dev/null; then
            log_info "Found S3 bucket: $bucket"
            
            if [ "$dry_run" = true ]; then
                echo "  [DRY RUN] Would empty and delete S3 bucket: $bucket"
                continue
            fi
            
            if ! confirm_deletion "S3 bucket ($bucket)" "$force"; then
                continue
            fi
            
            # Empty bucket first (including all versions)
            log_info "Emptying S3 bucket: $bucket"
            aws s3 rm "s3://$bucket" --recursive --region "$REGION" 2>/dev/null || true
            
            # Delete all object versions
            aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
                --query 'Versions[].{Key:Key,VersionId:VersionId}' --output text 2>/dev/null | \
                while read key version; do
                    if [ ! -z "$key" ] && [ ! -z "$version" ]; then
                        aws s3api delete-object --bucket "$bucket" --key "$key" --version-id "$version" --region "$REGION" 2>/dev/null || true
                    fi
                done
            
            # Delete all delete markers
            aws s3api list-object-versions --bucket "$bucket" --region "$REGION" \
                --query 'DeleteMarkers[].{Key:Key,VersionId:VersionId}' --output text 2>/dev/null | \
                while read key version; do
                    if [ ! -z "$key" ] && [ ! -z "$version" ]; then
                        aws s3api delete-object --bucket "$bucket" --key "$key" --version-id "$version" --region "$REGION" 2>/dev/null || true
                    fi
                done
            
            # Delete bucket
            log_info "Deleting S3 bucket: $bucket"
            aws s3api delete-bucket --bucket "$bucket" --region "$REGION" 2>/dev/null || true
            
            log_success "S3 bucket deleted: $bucket"
        fi
    done
}

# Clean up Lambda functions
cleanup_lambda_functions() {
    local dry_run=$1
    local force=$2
    
    log_info "Finding ForestShield Lambda functions..."
    
    local functions=$(aws lambda list-functions --region "$REGION" \
        --query "Functions[?starts_with(FunctionName, 'forestshield-')].FunctionName" \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$functions" ]; then
        log_info "No Lambda functions found"
        return 0
    fi
    
    for func in $functions; do
        log_info "Found Lambda function: $func"
        
        if [ "$dry_run" = true ]; then
            echo "  [DRY RUN] Would delete Lambda function: $func"
            continue
        fi
        
        if ! confirm_deletion "Lambda function ($func)" "$force"; then
            continue
        fi
        
        log_info "Deleting Lambda function: $func"
        aws lambda delete-function --function-name "$func" --region "$REGION" 2>/dev/null || true
        
        log_success "Lambda function deleted: $func"
    done
}

# Clean up ECR repositories
cleanup_ecr_repositories() {
    local dry_run=$1
    local force=$2
    
    log_info "Finding ForestShield ECR repositories..."
    
    local repos=$(aws ecr describe-repositories --region "$REGION" \
        --query "repositories[?starts_with(repositoryName, 'forestshield')].repositoryName" \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$repos" ]; then
        log_info "No ECR repositories found"
        return 0
    fi
    
    for repo in $repos; do
        log_info "Found ECR repository: $repo"
        
        if [ "$dry_run" = true ]; then
            echo "  [DRY RUN] Would delete ECR repository: $repo"
            continue
        fi
        
        if ! confirm_deletion "ECR repository ($repo)" "$force"; then
            continue
        fi
        
        log_info "Deleting ECR repository: $repo"
        aws ecr delete-repository --repository-name "$repo" --region "$REGION" --force 2>/dev/null || true
        
        log_success "ECR repository deleted: $repo"
    done
}

# Clean up IAM roles (detach policies first)
cleanup_iam_roles() {
    local dry_run=$1
    local force=$2
    
    log_info "Finding ForestShield IAM roles..."
    
    local roles=$(aws iam list-roles --query "Roles[?starts_with(RoleName, 'FS')].RoleName" --output text 2>/dev/null || echo "")
    
    if [ -z "$roles" ]; then
        log_info "No IAM roles found"
        return 0
    fi
    
    for role in $roles; do
        log_info "Found IAM role: $role"
        
        if [ "$dry_run" = true ]; then
            echo "  [DRY RUN] Would delete IAM role: $role"
            continue
        fi
        
        if ! confirm_deletion "IAM role ($role)" "$force"; then
            continue
        fi
        
        # Detach managed policies
        log_info "Detaching managed policies from role: $role"
        aws iam list-attached-role-policies --role-name "$role" --query 'AttachedPolicies[].PolicyArn' --output text 2>/dev/null | \
            while read policy_arn; do
                if [ ! -z "$policy_arn" ]; then
                    aws iam detach-role-policy --role-name "$role" --policy-arn "$policy_arn" 2>/dev/null || true
                fi
            done
        
        # Delete inline policies
        log_info "Deleting inline policies from role: $role"
        aws iam list-role-policies --role-name "$role" --query 'PolicyNames' --output text 2>/dev/null | \
            while read policy_name; do
                if [ ! -z "$policy_name" ]; then
                    aws iam delete-role-policy --role-name "$role" --policy-name "$policy_name" 2>/dev/null || true
                fi
            done
        
        # Remove instance profiles
        log_info "Removing instance profiles from role: $role"
        aws iam list-instance-profiles-for-role --role-name "$role" --query 'InstanceProfiles[].InstanceProfileName' --output text 2>/dev/null | \
            while read profile_name; do
                if [ ! -z "$profile_name" ]; then
                    aws iam remove-role-from-instance-profile --instance-profile-name "$profile_name" --role-name "$role" 2>/dev/null || true
                fi
            done
        
        # Delete the role
        log_info "Deleting IAM role: $role"
        aws iam delete-role --role-name "$role" 2>/dev/null || true
        
        log_success "IAM role deleted: $role"
    done
}

# Clean up ElastiCache clusters
cleanup_elasticache_clusters() {
    local dry_run=$1
    local force=$2
    
    log_info "Finding ForestShield ElastiCache clusters..."
    
    # Get replication groups
    local replication_groups=$(aws elasticache describe-replication-groups --region "$REGION" \
        --query "ReplicationGroups[?starts_with(ReplicationGroupId, 'forg') || contains(ReplicationGroupId, 'forestshield')].ReplicationGroupId" \
        --output text 2>/dev/null || echo "")
    
    if [ ! -z "$replication_groups" ]; then
        for group in $replication_groups; do
            log_info "Found ElastiCache replication group: $group"
            
            if [ "$dry_run" = true ]; then
                echo "  [DRY RUN] Would delete ElastiCache replication group: $group"
                continue
            fi
            
            if ! confirm_deletion "ElastiCache replication group ($group)" "$force"; then
                continue
            fi
            
            log_info "Deleting ElastiCache replication group: $group"
            aws elasticache delete-replication-group \
                --replication-group-id "$group" \
                --region "$REGION" 2>/dev/null || true
            
            log_success "ElastiCache replication group deleted: $group"
        done
    fi
    
    # Get individual cache clusters
    local cache_clusters=$(aws elasticache describe-cache-clusters --region "$REGION" \
        --query "CacheClusters[?starts_with(CacheClusterId, 'forg') || contains(CacheClusterId, 'forestshield')].CacheClusterId" \
        --output text 2>/dev/null || echo "")
    
    if [ ! -z "$cache_clusters" ]; then
        for cluster in $cache_clusters; do
            log_info "Found ElastiCache cluster: $cluster"
            
            if [ "$dry_run" = true ]; then
                echo "  [DRY RUN] Would delete ElastiCache cluster: $cluster"
                continue
            fi
            
            if ! confirm_deletion "ElastiCache cluster ($cluster)" "$force"; then
                continue
            fi
            
            log_info "Deleting ElastiCache cluster: $cluster"
            aws elasticache delete-cache-cluster \
                --cache-cluster-id "$cluster" \
                --region "$REGION" 2>/dev/null || true
            
            log_success "ElastiCache cluster deleted: $cluster"
        done
    fi
    
    if [ -z "$replication_groups" ] && [ -z "$cache_clusters" ]; then
        log_info "No ElastiCache clusters found"
    fi
}

# Clean up DynamoDB tables
cleanup_dynamodb_tables() {
    local dry_run=$1
    local force=$2
    
    log_info "Finding ForestShield DynamoDB tables..."
    
    local tables=$(aws dynamodb list-tables --region "$REGION" \
        --query "TableNames[?starts_with(@, 'forestshield-')]" \
        --output text 2>/dev/null || echo "")
    
    if [ -z "$tables" ]; then
        log_info "No DynamoDB tables found"
        return 0
    fi
    
    for table in $tables; do
        log_info "Found DynamoDB table: $table"
        
        if [ "$dry_run" = true ]; then
            echo "  [DRY RUN] Would delete DynamoDB table: $table"
            continue
        fi
        
        if ! confirm_deletion "DynamoDB table ($table)" "$force"; then
            continue
        fi
        
        # Disable deletion protection if enabled
        log_info "Disabling deletion protection for table: $table"
        aws dynamodb update-table --table-name "$table" --region "$REGION" \
            --deletion-protection-enabled false 2>/dev/null || true
        
        # Delete the table
        log_info "Deleting DynamoDB table: $table"
        aws dynamodb delete-table --table-name "$table" --region "$REGION" 2>/dev/null || true
        
        log_success "DynamoDB table deleted: $table"
    done
}

# Main cleanup function
run_cleanup() {
    local dry_run=$1
    local force=$2
    local stack_only=$3
    local lambdas_only=$4
    local ecr_only=$5
    local buckets_only=$6
    local nuclear=$7
    
    if [ "$dry_run" = true ]; then
        log_warning "DRY RUN MODE - No resources will actually be deleted"
        echo ""
    fi
    
    if [ "$nuclear" = true ]; then
        if [ "$force" != true ]; then
            log_error "Nuclear option requires --force flag"
            exit 1
        fi
        log_warning "NUCLEAR CLEANUP - Deleting ALL ForestShield resources"
        echo ""
    fi
    
    # Determine what to clean up
    if [ "$stack_only" = true ]; then
        cleanup_cloudformation_stack "$dry_run" "$force"
    elif [ "$lambdas_only" = true ]; then
        cleanup_lambda_functions "$dry_run" "$force"
    elif [ "$ecr_only" = true ]; then
        cleanup_ecr_repositories "$dry_run" "$force"
    elif [ "$buckets_only" = true ]; then
        cleanup_s3_buckets "$dry_run" "$force"
    elif [ "$nuclear" = true ]; then
        # Nuclear cleanup - everything in dependency order
        cleanup_cloudformation_stack "$dry_run" "$force"
        cleanup_lambda_functions "$dry_run" "$force"
        cleanup_ecr_repositories "$dry_run" "$force"
        cleanup_s3_buckets "$dry_run" "$force"
        cleanup_elasticache_clusters "$dry_run" "$force"
        cleanup_iam_roles "$dry_run" "$force"
        cleanup_dynamodb_tables "$dry_run" "$force"
    else
        # Default cleanup - check ALL resource types (not just CloudFormation)
        log_info "Scanning for ALL ForestShield resources..."
        cleanup_cloudformation_stack "$dry_run" "$force"
        cleanup_lambda_functions "$dry_run" "$force"
        cleanup_ecr_repositories "$dry_run" "$force"
        cleanup_s3_buckets "$dry_run" "$force"
        cleanup_elasticache_clusters "$dry_run" "$force"
        cleanup_iam_roles "$dry_run" "$force"
        cleanup_dynamodb_tables "$dry_run" "$force"
    fi
    
    if [ "$dry_run" = false ]; then
        log_success "Cleanup completed!"
    else
        log_info "Dry run completed - no resources were deleted"
    fi
}

# Main logic
main() {
    init_config
    
    local dry_run=false
    local force=false
    local stack_only=false
    local lambdas_only=false
    local ecr_only=false
    local buckets_only=false
    local nuclear=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -d|--dry-run)
                dry_run=true
                shift
                ;;
            -f|--force)
                force=true
                shift
                ;;
            -s|--stack-only)
                stack_only=true
                shift
                ;;
            -l|--lambdas-only)
                lambdas_only=true
                shift
                ;;
            -e|--ecr-only)
                ecr_only=true
                shift
                ;;
            -b|--buckets-only)
                buckets_only=true
                shift
                ;;
            --nuclear)
                nuclear=true
                shift
                ;;
            -*)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
            *)
                log_error "Unknown argument: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    run_cleanup "$dry_run" "$force" "$stack_only" "$lambdas_only" "$ecr_only" "$buckets_only" "$nuclear"
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 