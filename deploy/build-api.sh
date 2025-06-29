#!/bin/bash

# 🐳 ForestShield API Container Builder
# Build and push Docker container to ECR

set -e

# Assuming config.sh is in the same directory
source "$(dirname "$0")/config.sh"

show_help() {
    echo "🐳 API Container Builder - Fast & Efficient"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Default behavior (no options): Builds image using cache and pushes to ECR."
    echo ""
    echo "Options:"
    echo "  -h, --help          Show this help message"
    echo "  -b, --build-only    Only build the image, don't push to ECR"
    echo "  -p, --push-only     Only push to ECR (assumes image is already built)"
    echo "  --no-cache          Build the image without using Docker's cache"
    echo "  --force-clean       DANGEROUS: Deletes the entire ECR repo before building."
    echo ""
    echo "Examples:"
    echo "  $0                  # Fast update: build with cache & push"
    echo "  $0 --no-cache       # Force a full rebuild & push"
    echo "  $0 -b               # Build only, useful for local testing"
    echo "  $0 --force-clean    # The slow, nuke-it-all option"
}

create_ecr_repo() {
    log_info "Checking ECR repository '$ECR_REPO_NAME'..."
    if ! aws ecr describe-repositories --repository-names "$ECR_REPO_NAME" --region "$REGION" &>/dev/null; then
        log_info "ECR repository not found. Creating it..."
        aws ecr create-repository \
            --repository-name "$ECR_REPO_NAME" \
            --region "$REGION" \
            --image-scanning-configuration scanOnPush=true \
            --encryption-configuration '{"encryptionType":"AES256"}' \
            --tags Key=Project,Value=ForestShield
        log_success "ECR repository created."
    else
        log_success "ECR repository already exists."
    fi
}

clean_ecr_repo() {
    log_warning "🔥 Deleting entire ECR repository: $ECR_REPO_NAME..."
    if ! aws ecr delete-repository --repository-name "$ECR_REPO_NAME" --region "$REGION" --force; then
      log_info "Repository did not exist, nothing to delete."
    else
      log_success "ECR repository deleted."
    fi
}

build_container() {
    local no_cache_arg=""
    if [ "$1" = "--no-cache" ]; then
        log_warning "Building without cache..."
        no_cache_arg="--no-cache"
    else
        log_info "Building API container using cache for speed..."
    fi

    if [ ! -f "$DOCKERFILE_PATH/Dockerfile" ]; then
        log_error "Dockerfile not found at $DOCKERFILE_PATH/Dockerfile"
        exit 1
    fi

    # Generate a unique tag for this build to ensure App Runner picks it up
    local unique_tag
    unique_tag=$(date +%Y%m%d-%H%M%S)

    log_info "Building and tagging image as:"
    log_info "  - $ECR_REPO_NAME:latest"
    log_info "  - $ECR_REPO_NAME:$unique_tag"

    docker build $no_cache_arg \
      -t "$ECR_REPO_NAME:latest" \
      -t "$ECR_REPO_NAME:$unique_tag" \
      "$DOCKERFILE_PATH"

    # Tag for ECR push
    docker tag "$ECR_REPO_NAME:$unique_tag" "$ECR_REPOSITORY_URI:$unique_tag"
    docker tag "$ECR_REPO_NAME:latest" "$ECR_REPOSITORY_URI:latest"

    log_success "Container built successfully."
}

push_to_ecr() {
    log_info "Pushing container to ECR..."
    
    log_info "Logging in to ECR..."
    aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ECR_REPOSITORY_URI"
    
    log_info "Pushing all tags to $ECR_REPOSITORY_URI..."
    docker push --all-tags "$ECR_REPOSITORY_URI"
    
    log_success "Container pushed successfully to ECR."
    log_info "App Runner will now automatically deploy the new version."
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Please install Docker first."
        exit 1
    fi
    
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running. Please start Docker."
        exit 1
    fi
}

# Main logic
main() {
    init_config
    check_docker
    
    local build_only=false
    local push_only=false
    local force_clean=false
    local no_cache=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -b|--build-only)
                build_only=true
                shift
                ;;
            -p|--push-only)
                push_only=true
                shift
                ;;
            --no-cache)
                no_cache=true
                shift
                ;;
            --force-clean)
                force_clean=true
                shift
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    if [ "$build_only" = true ] && [ "$push_only" = true ]; then
        log_error "Cannot use --build-only and --push-only together."
        exit 1
    fi
    
    if [ "$force_clean" = true ]; then
        clean_ecr_repo
    fi

    # Always ensure the repo exists before building or pushing
    create_ecr_repo
    
    if [ "$push_only" = false ]; then
        local build_args=""
        if [ "$no_cache" = true ]; then
            build_args="--no-cache"
        fi
        build_container "$build_args"
    fi
    
    if [ "$build_only" = false ]; then
        push_to_ecr
    fi
    
    log_success "✅ API container operations completed!"
}

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi 