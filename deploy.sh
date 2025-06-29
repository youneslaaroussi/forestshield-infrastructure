#!/bin/bash

# 🚀 ForestShield Deployment Orchestrator
# Modular deployment with granular control

set -e

SCRIPT_DIR="$(dirname "$0")"
DEPLOY_DIR="$SCRIPT_DIR/deploy"

# Source configuration
source "$DEPLOY_DIR/config.sh"

show_help() {
    echo "🚀 ForestShield Deployment Orchestrator"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  lambdas         Build and deploy Lambda functions"
    echo "    -l, --list    List available functions"
    echo "    -u, --upload  Upload to S3 after building"
    echo "    [function]    Build specific function (e.g., search-images)"
    echo ""
    echo "  api             Build and deploy API container"
    echo "    -b, --build-only    Only build, don't push"
    echo "    -p, --push-only     Only push to ECR"
    echo "    -f, --force-clean   Clean ECR repo first"
    echo ""
    echo "  stack           Deploy CloudFormation stack"
    echo "    -v, --validate-only Validate template only"
    echo "    -s, --status        Show stack status"
    echo "    -e, --events        Show stack events"
    echo "    -f, --fix-rollback  Fix failed rollback"
    echo "    -d, --delete        Delete stack"
    echo "    -w, --watch         Watch deployment progress"
    echo ""
    echo "  cleanup         Clean up AWS resources"
    echo "    -d, --dry-run       Show what would be deleted"
    echo "    -f, --force         Skip confirmations (DANGEROUS)"
    echo "    -s, --stack-only    Delete only CloudFormation stack"
    echo "    -l, --lambdas-only  Delete only Lambda functions"
    echo "    -e, --ecr-only      Delete only ECR repositories"
    echo "    -b, --buckets-only  Delete only S3 buckets"
    echo "    --nuclear           Delete EVERYTHING (requires --force)"
    echo ""
    echo "  domain          Connect custom domain to App Runner service"
    echo ""
    echo "  full            Full deployment (default)"
    echo "    --skip-lambdas      Skip Lambda building"
    echo "    --skip-api          Skip API container"
    echo "    --skip-stack        Skip CloudFormation"
    echo ""
    echo "Examples:"
    echo "  $0                              # Full deployment"
    echo "  $0 lambdas search-images        # Build only search-images function"
    echo "  $0 lambdas -u                   # Build all lambdas and upload to S3"
    echo "  $0 api -b                       # Build API container only"
    echo "  $0 stack -v                     # Validate CloudFormation template"
    echo "  $0 stack -f                     # Fix failed rollback"
    echo "  $0 cleanup -d                   # Dry run - show what would be deleted"
    echo "  $0 cleanup -s                   # Delete only CloudFormation stack"
    echo "  $0 cleanup --nuclear -f         # Delete EVERYTHING (requires --force)"
    echo "  $0 domain                       # Connect custom domain to App Runner"
    echo "  $0 full --skip-api              # Full deployment but skip API"
    echo ""
    echo "🔧 Configuration:"
    echo "  Stack: $STACK_NAME"
    echo "  Region: $REGION"
    echo "  Environment: $ENVIRONMENT"
}

run_full_deployment() {
    local skip_lambdas=false
    local skip_api=false
    local skip_stack=false
    
    # Parse options
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-lambdas)
                skip_lambdas=true
                shift
                ;;
            --skip-api)
                skip_api=true
                shift
                ;;
            --skip-stack)
                skip_stack=true
                shift
                ;;
            -*)
                log_error "Unknown option for full deployment: $1"
                exit 1
                ;;
            *)
                log_error "Unknown argument for full deployment: $1"
                exit 1
                ;;
        esac
    done
    
    log_info "🚀 Starting Full ForestShield Deployment"
    log_info "Stack: $STACK_NAME | Region: $REGION | Environment: $ENVIRONMENT"
    echo ""
    
    # Step 1: Build Lambda functions
    if [ "$skip_lambdas" = false ]; then
        log_info "📦 Step 1: Building Lambda functions..."
        "$DEPLOY_DIR/build-lambdas.sh" --upload
        echo ""
    else
        log_warning "⏭️  Skipping Lambda functions build"
    fi
    
    # Step 2: Build API container
    if [ "$skip_api" = false ]; then
        log_info "🐳 Step 2: Building API container..."
        "$DEPLOY_DIR/build-api.sh" --force-clean
        echo ""
    else
        log_warning "⏭️  Skipping API container build"
    fi
    
    # Step 3: Deploy CloudFormation stack
    if [ "$skip_stack" = false ]; then
        log_info "☁️  Step 3: Deploying CloudFormation stack..."
        "$DEPLOY_DIR/deploy-stack.sh"
        echo ""
    else
        log_warning "⏭️  Skipping CloudFormation deployment"
    fi
    
    log_success "🎉 Full deployment completed!"
}

# Main logic
main() {
    init_config
    
    if [ $# -eq 0 ]; then
        # No arguments, run full deployment
        run_full_deployment
        return
    fi
    
    local command=$1
    shift
    
    case $command in
        lambdas)
            "$DEPLOY_DIR/build-lambdas.sh" "$@"
            ;;
        api)
            "$DEPLOY_DIR/build-api.sh" "$@"
            ;;
        stack)
            "$DEPLOY_DIR/deploy-stack.sh" "$@"
            ;;
        cleanup)
            "$DEPLOY_DIR/cleanup.sh" "$@"
            ;;
        domain)
            "$DEPLOY_DIR/connect-custom-domain.sh" "$@"
            ;;
        full)
            run_full_deployment "$@"
            ;;
        -h|--help|help)
            show_help
            ;;
        *)
            log_error "Unknown command: $command"
            echo ""
            show_help
            exit 1
            ;;
    esac
}

# Run main function
main "$@" 