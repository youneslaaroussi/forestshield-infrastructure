#!/bin/bash

# 🔨 ForestShield Lambda Builder
# Build individual or all Lambda functions

set -e

source "$(dirname "$0")/config.sh"

# Available Lambda functions
LAMBDA_FUNCTIONS=(
    "vegetation-analyzer"
    "results-consolidator"
    "model-manager"
    "visualization-generator"
    "k-selector"
    "search-images"
    "sagemaker-processor"
)

show_help() {
    echo "🔨 Lambda Builder"
    echo ""
    echo "Usage: $0 [OPTIONS] [FUNCTION_NAME]"
    echo ""
    echo "Options:"
    echo "  -h, --help          Show this help message"
    echo "  -a, --all           Build all Lambda functions (default)"
    echo "  -u, --upload        Upload to S3 and update Lambda functions after building"
    echo "  -l, --list          List available functions"
    echo ""
    echo "Available Functions:"
    for func in "${LAMBDA_FUNCTIONS[@]}"; do
        echo "  • $func"
    done
    echo ""
    echo "Examples:"
    echo "  $0                           # Build all functions"
    echo "  $0 -u                        # Build all and upload to S3"
    echo "  $0 search-images             # Build only search-images"
    echo "  $0 -u vegetation-analyzer    # Build, upload and update vegetation-analyzer"
}

list_functions() {
    echo "📋 Available Lambda Functions:"
    for func in "${LAMBDA_FUNCTIONS[@]}"; do
        echo "  • $func"
    done
}

build_python_function() {
    local func_name=$1
    local func_dir="lambda-functions/$func_name"
    
    if [ ! -d "$func_dir" ]; then
        log_error "Function directory not found: $func_dir"
        return 1
    fi

    log_info "Building Python function: $func_name"
    
    (
        cd "$func_dir"
        if [ -f "build.sh" ]; then
            chmod +x build.sh
            if ! ./build.sh; then
                log_error "Build script failed for $func_name"
                return 1
            fi
            
            local zip_file="$func_name-deployment.zip"
            if [ "$func_name" == "k-selector" ]; then
                zip_file="k-selector-lambda.zip"
            fi
            
            if [ ! -f "$zip_file" ]; then
                log_error "Build script ran but $zip_file was not created"
                return 1
            fi
            log_success "Built $func_name successfully"
        else
            log_error "build.sh not found in $func_dir"
            return 1
        fi
    )
}

build_java_function() {
    local func_name=$1
    local func_dir="lambda-functions/$func_name"
    
    if [ ! -d "$func_dir" ]; then
        log_error "Function directory not found: $func_dir"
        return 1
    fi

    log_info "Building Java function: $func_name"
    
    (
        cd "$func_dir"
        if [ -f "pom.xml" ]; then
            mvn clean package -DskipTests
            
            local jar_file="target/$func_name-1.0.0.jar"
            if [ ! -f "$jar_file" ]; then
                log_error "JAR file not created: $jar_file"
                return 1
            fi
            log_success "Built $func_name successfully"
        else
            log_error "pom.xml not found in $func_dir"
            return 1
        fi
    )
}

build_single_function() {
    local func_name=$1
    
    case $func_name in
        "vegetation-analyzer"|"results-consolidator"|"model-manager"|"visualization-generator"|"k-selector")
            build_python_function "$func_name"
            ;;
        "search-images"|"sagemaker-processor")
            build_java_function "$func_name"
            ;;
        *)
            log_error "Unknown function: $func_name"
            log_info "Available functions: ${LAMBDA_FUNCTIONS[*]}"
            return 1
            ;;
    esac
}

build_all_functions() {
    log_info "Building all Lambda functions..."
    
    # Build Python functions first (they're more likely to fail)
    for func in "vegetation-analyzer" "results-consolidator" "model-manager" "visualization-generator" "k-selector"; do
        build_single_function "$func"
    done
    
    # Build Java functions
    for func in "search-images" "sagemaker-processor"; do
        build_single_function "$func"
    done
    
    log_success "All Lambda functions built successfully!"
}

update_lambda_function() {
    local func_name=$1
    local s3_key=$2
    
    # Map function names to AWS Lambda function names
    local lambda_function_name
    case $func_name in
        "vegetation-analyzer")
            lambda_function_name="forestshield-vegetation-analyzer"
            ;;
        "results-consolidator")
            lambda_function_name="forestshield-results-consolidator"
            ;;
        "model-manager")
            lambda_function_name="forestshield-model-manager"
            ;;
        "visualization-generator")
            lambda_function_name="forestshield-visualization-generator"
            ;;
        "k-selector")
            lambda_function_name="forestshield-k-selector"
            ;;
        "search-images")
            lambda_function_name="forestshield-search-images"
            ;;
        "sagemaker-processor")
            lambda_function_name="forestshield-sagemaker-processor"
            ;;
        *)
            log_error "Unknown function for Lambda update: $func_name"
            return 1
            ;;
    esac
    
    log_info "Updating Lambda function: $lambda_function_name..."
    
    if aws lambda update-function-code \
        --function-name "$lambda_function_name" \
        --s3-bucket "$LAMBDA_DEPLOY_BUCKET" \
        --s3-key "$s3_key" \
        --region "$REGION" \
        --output table > /dev/null; then
        log_success "Updated Lambda function: $lambda_function_name"
    else
        log_error "Failed to update Lambda function: $lambda_function_name"
        return 1
    fi
}

upload_function() {
    local func_name=$1
    
    # Ensure S3 bucket exists
    aws s3 mb "s3://$LAMBDA_DEPLOY_BUCKET" --region "$REGION" 2>/dev/null || true
    aws s3api put-bucket-versioning \
        --bucket "$LAMBDA_DEPLOY_BUCKET" \
        --versioning-configuration Status=Enabled \
        --region "$REGION" 2>/dev/null || true
    
    case $func_name in
        "vegetation-analyzer"|"results-consolidator"|"model-manager"|"visualization-generator")
            local zip_file="lambda-functions/$func_name/$func_name-deployment.zip"
            local s3_key="$func_name-deployment.zip"
            ;;
        "k-selector")
            local zip_file="lambda-functions/k-selector/k-selector-lambda.zip"
            local s3_key="k-selector-lambda.zip"
            ;;
        "search-images"|"sagemaker-processor")
            local zip_file="lambda-functions/$func_name/target/$func_name-1.0.0.jar"
            local s3_key="$func_name-1.0.0.jar"
            ;;
        *)
            log_error "Unknown function for upload: $func_name"
            return 1
            ;;
    esac
    
    if [ -f "$zip_file" ]; then
        log_info "Uploading $func_name to S3..."
        aws s3 cp "$zip_file" "s3://$LAMBDA_DEPLOY_BUCKET/$s3_key" \
            --region "$REGION" --only-show-errors
        log_success "Uploaded $func_name"
        
        # Update Lambda function to use new code
        update_lambda_function "$func_name" "$s3_key"
    else
        log_error "Build artifact not found: $zip_file"
        return 1
    fi
}

upload_all_functions() {
    log_info "Uploading all Lambda functions to S3..."
    for func in "${LAMBDA_FUNCTIONS[@]}"; do
        upload_function "$func"
    done
    log_success "All functions uploaded and updated successfully!"
}

# Main logic
main() {
    init_config
    
    local upload=false
    local build_all=true
    local target_function=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -a|--all)
                build_all=true
                shift
                ;;
            -u|--upload)
                upload=true
                shift
                ;;
            -l|--list)
                list_functions
                exit 0
                ;;
            -*)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
            *)
                target_function="$1"
                build_all=false
                shift
                ;;
        esac
    done
    
    if [ "$build_all" = true ]; then
        build_all_functions
        if [ "$upload" = true ]; then
            upload_all_functions
        fi
    else
        build_single_function "$target_function"
        if [ "$upload" = true ]; then
            upload_function "$target_function"
        fi
    fi
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 