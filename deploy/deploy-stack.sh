#!/bin/bash

# ☁️ ForestShield CloudFormation Deployer
# Fast and surgical CloudFormation deployments

set -e

source "$(dirname "$0")/config.sh"

show_help() {
    echo "☁️ CloudFormation Stack Deployer"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help              Show this help message"
    echo "  -v, --validate-only     Only validate template syntax"
    echo "  -s, --status            Show current stack status"
    echo "  -e, --events            Show recent stack events"
    echo "  -f, --fix-rollback      Fix failed rollback state"
    echo "  -d, --delete            Delete the stack"
    echo "  -w, --watch             Watch deployment progress"
    echo "  --no-upload             Use template file directly (for small templates)"
    echo ""
    echo "Examples:"
    echo "  $0                      # Deploy stack"
    echo "  $0 -v                   # Validate template only"
    echo "  $0 -s                   # Check stack status"
    echo "  $0 -f                   # Fix rollback failure"
    echo "  $0 -w                   # Deploy and watch progress"
}

validate_template() {
    log_info "Validating CloudFormation template..."
    
    # Check template size and upload to S3 if needed
    local template_size
    if command -v stat >/dev/null 2>&1; then
        template_size=$(stat -c%s "$TEMPLATE_FILE" 2>/dev/null || wc -c < "$TEMPLATE_FILE")
    else
        template_size=$(wc -c < "$TEMPLATE_FILE")
    fi
    
    log_info "Template size: $template_size bytes"
    
    if [ "$template_size" -gt 51200 ]; then
        log_info "Template exceeds 51KB, uploading to S3 for validation..."
        
        # Create S3 bucket if needed
        aws s3api head-bucket --bucket "$TEMPLATE_BUCKET" --region "$REGION" 2>/dev/null || {
            log_info "Creating template bucket: $TEMPLATE_BUCKET"
            aws s3api create-bucket --bucket "$TEMPLATE_BUCKET" --region "$REGION" \
                --create-bucket-configuration LocationConstraint="$REGION"
            aws s3api put-bucket-versioning --bucket "$TEMPLATE_BUCKET" \
                --versioning-configuration Status=Enabled --region "$REGION"
        }
        
        # Upload template
        local template_key="cloudformation-${STACK_NAME}-$(date +%Y%m%d%H%M%S).yaml"
        aws s3 cp "$TEMPLATE_FILE" "s3://$TEMPLATE_BUCKET/$template_key" --region "$REGION"
        local template_url="https://s3.amazonaws.com/$TEMPLATE_BUCKET/$template_key"
        
        # Validate using S3 URL
        if ! aws cloudformation validate-template --template-url "$template_url" --region "$REGION" >/dev/null; then
            log_error "Template validation failed"
            return 1
        fi
    else
        # Validate local file directly for small templates
        if ! aws cloudformation validate-template --template-body "file://$TEMPLATE_FILE" --region "$REGION" >/dev/null; then
            log_error "Template validation failed"
            return 1
        fi
    fi
    
    log_success "Template is valid"
}

get_stack_status() {
    aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
        --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "DOES_NOT_EXIST"
}

show_stack_status() {
    local status=$(get_stack_status)
    echo "📊 Stack Status: $status"
    
    if [ "$status" != "DOES_NOT_EXIST" ]; then
        echo ""
        echo "📋 Stack Information:"
        aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
            --query 'Stacks[0].{Status:StackStatus,Created:CreationTime,Updated:LastUpdatedTime}' \
            --output table
    fi
}

show_stack_events() {
    log_info "Recent stack events:"
    aws cloudformation describe-stack-events --stack-name "$STACK_NAME" --region "$REGION" \
        --query "StackEvents[0:10].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]" \
        --output table 2>/dev/null || {
        log_warning "Stack not found or no events available"
    }
}

show_failed_events() {
    log_info "Failed stack events:"
    aws cloudformation describe-stack-events --stack-name "$STACK_NAME" --region "$REGION" \
        --query "StackEvents[?ResourceStatus=='CREATE_FAILED' || ResourceStatus=='UPDATE_FAILED'].[LogicalResourceId, ResourceType, ResourceStatusReason]" \
        --output table 2>/dev/null || {
        log_warning "No failed events found"
    }
}

fix_rollback() {
    local status=$(get_stack_status)
    
    if [ "$status" == "UPDATE_ROLLBACK_FAILED" ]; then
        log_info "Fixing rollback failure..."
        aws cloudformation continue-update-rollback \
            --stack-name "$STACK_NAME" \
            --region "$REGION"
        log_success "Rollback continuation initiated. Monitor progress in AWS Console."
    else
        log_warning "Stack is not in UPDATE_ROLLBACK_FAILED state (current: $status)"
    fi
}

delete_stack() {
    local status=$(get_stack_status)
    
    if [ "$status" == "DOES_NOT_EXIST" ]; then
        log_warning "Stack does not exist"
        return 0
    fi
    
    log_warning "Deleting stack: $STACK_NAME"
    read -p "Are you sure? Type 'yes' to confirm: " confirm
    
    if [ "$confirm" == "yes" ]; then
        # Disable termination protection if enabled
        aws cloudformation update-termination-protection \
            --stack-name "$STACK_NAME" \
            --no-enable-termination-protection \
            --region "$REGION" 2>/dev/null || true
        
        aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
        log_success "Stack deletion initiated"
    else
        log_info "Stack deletion cancelled"
    fi
}

prepare_template() {
    local use_s3=$1
    
    if [ "$use_s3" = true ]; then
        # Check template size
        local template_size
        if command -v stat >/dev/null 2>&1; then
            template_size=$(stat -c%s "$TEMPLATE_FILE" 2>/dev/null || wc -c < "$TEMPLATE_FILE")
        else
            template_size=$(wc -c < "$TEMPLATE_FILE")
        fi
        
        log_info "Template size: $template_size bytes"
        
        if [ "$template_size" -gt 51200 ]; then
            log_info "Template exceeds 51KB, uploading to S3..."
            
            # Create S3 bucket if needed
            aws s3api head-bucket --bucket "$TEMPLATE_BUCKET" --region "$REGION" 2>/dev/null || {
                log_info "Creating template bucket: $TEMPLATE_BUCKET"
                aws s3api create-bucket --bucket "$TEMPLATE_BUCKET" --region "$REGION" \
                    --create-bucket-configuration LocationConstraint="$REGION"
                aws s3api put-bucket-versioning --bucket "$TEMPLATE_BUCKET" \
                    --versioning-configuration Status=Enabled --region "$REGION"
            }
            
            # Upload template
            local template_key="cloudformation-${STACK_NAME}-$(date +%Y%m%d%H%M%S).yaml"
            aws s3 cp "$TEMPLATE_FILE" "s3://$TEMPLATE_BUCKET/$template_key" --region "$REGION"
            echo "--template-url https://s3.amazonaws.com/$TEMPLATE_BUCKET/$template_key"
        else
            echo "--template-body file://$TEMPLATE_FILE"
        fi
    else
        echo "--template-body file://$TEMPLATE_FILE"
    fi
}

deploy_stack() {
    local use_s3=$1
    local watch=$2
    
    validate_template || return 1
    
    log_info "Gathering deployment parameters..."
    local template_params
    
    local template_param=$(prepare_template "$use_s3")
    local status=$(get_stack_status)
    
    log_info "Current stack status: $status"
    
    # Handle problematic states by deleting the stack so it can be recreated
    case $status in
        "DELETE_IN_PROGRESS")
            log_info "Stack deletion is already in progress. Waiting for it to complete..."
            if ! aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"; then
                log_error "Stack deletion failed. Check the AWS Console. The next run should handle the 'DELETE_FAILED' state."
                exit 1
            fi
            log_success "Stack successfully deleted. Proceeding with deployment."
            status="DOES_NOT_EXIST" 
            ;;
        "ROLLBACK_COMPLETE"|"UPDATE_ROLLBACK_FAILED"|"ROLLBACK_FAILED"|"CREATE_FAILED"|"DELETE_FAILED")
            log_warning "Stack is in a non-deployable state ($status). It must be deleted before redeployment."
            log_info "Attempting to delete stack: $STACK_NAME"
            
            # First, try a normal delete
            aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION"
            
            log_info "Waiting for stack deletion to complete..."
            if ! aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"; then
                log_warning "Standard stack deletion failed. This is likely due to a stuck resource (e.g., Redis)."
                log_info "Attempting to delete the stack again while retaining the stuck resource (RedisCluster)..."
                
                # If the normal delete fails, try again but retain the known problematic resource.
                # This allows the stack to be deleted so a new one can be created.
                aws cloudformation delete-stack --stack-name "$STACK_NAME" --region "$REGION" --retain-resources "RedisCluster"
                
                log_info "Waiting for stack deletion (with retained resource)..."
                if ! aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME" --region "$REGION"; then
                    log_error "Failed to delete stack even after retaining resources. Manual intervention required."
                    log_info "Please go to the AWS CloudFormation console, find the resource that is in DELETE_FAILED state, and manually delete it. Then re-run the deployment."
                    exit 1
                fi
            fi
            
            log_success "Stack successfully deleted. A new stack will be created."
            # Update status since the stack is now gone
            status="DOES_NOT_EXIST"
            ;;
    esac
    
    # Prepare parameters
    local params=""
    if [ -f "cfn-parameters-${ENVIRONMENT}.json" ]; then
        log_info "Using parameters from cfn-parameters-${ENVIRONMENT}.json"
        if command -v jq >/dev/null 2>&1; then
            params=$(jq -r '.[] | .ParameterKey + "=" + .ParameterValue' "cfn-parameters-${ENVIRONMENT}.json" | tr '\n' ' ')
        else
            log_warning "jq not found, using default parameters"
        fi
    fi
    
    log_info "Deploying CloudFormation stack..."
    
    # Use aws cloudformation deploy for simplicity
    if [ -n "$params" ]; then
        aws cloudformation deploy \
            --template-file cloudformation.yaml \
            --stack-name "$STACK_NAME" \
            --s3-bucket "$TEMPLATE_BUCKET" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "$REGION" \
            --parameter-overrides $params
    else
        aws cloudformation deploy \
            --template-file cloudformation.yaml \
            --stack-name "$STACK_NAME" \
            --s3-bucket "$TEMPLATE_BUCKET" \
            --capabilities CAPABILITY_NAMED_IAM \
            --region "$REGION"
    fi
    
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
        log_success "Stack deployment completed successfully!"
        
        # Show outputs
        log_info "Stack outputs:"
        aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
            --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
            --output table 2>/dev/null || true
            
        # Show Lambda functions
        log_info "Lambda functions created:"
        aws lambda list-functions --region "$REGION" \
            --query "Functions[?starts_with(FunctionName, 'forestshield-')].[FunctionName, Runtime]" \
            --output table 2>/dev/null || true
    else
        log_error "Stack deployment failed!"
        show_failed_events
        return $exit_code
    fi
}

watch_stack() {
    log_info "Watching stack events (press Ctrl+C to stop)..."
    while true; do
        clear
        show_stack_status
        echo ""
        show_stack_events
        sleep 10
    done
}

# Main logic
main() {
    init_config
    
    local validate_only=false
    local show_status=false
    local show_events=false
    local fix_rollback_flag=false
    local delete_flag=false
    local watch=false
    local use_s3=true
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -v|--validate-only)
                validate_only=true
                shift
                ;;
            -s|--status)
                show_status=true
                shift
                ;;
            -e|--events)
                show_events=true
                shift
                ;;
            -f|--fix-rollback)
                fix_rollback_flag=true
                shift
                ;;
            -d|--delete)
                delete_flag=true
                shift
                ;;
            -w|--watch)
                watch=true
                shift
                ;;
            --no-upload)
                use_s3=false
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
    
    # Execute based on options
    if [ "$validate_only" = true ]; then
        validate_template
    elif [ "$show_status" = true ]; then
        show_stack_status
    elif [ "$show_events" = true ]; then
        show_stack_events
    elif [ "$fix_rollback_flag" = true ]; then
        fix_rollback
    elif [ "$delete_flag" = true ]; then
        delete_stack
    elif [ "$watch" = true ]; then
        watch_stack
    else
        deploy_stack "$use_s3" "$watch"
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 