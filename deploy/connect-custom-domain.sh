#!/bin/bash

# 🌐 ForestShield Custom Domain Connector
# Connects the App Runner service to a custom domain with Route 53

set -e

# Load shared configuration and utilities
source "$(dirname "$0")/config.sh"

main() {
    # Initialize shared configuration (loads AWS account info, etc.)
    init_config

    # --- Configuration ---
    # These are the values for your specific setup.
    CUSTOM_DOMAIN="api.forestshieldapp.com"
    HOSTED_ZONE_NAME="forestshieldapp.com"
    # --- End Configuration ---

    log_info "🚀 Starting custom domain connection for App Runner"
    log_info "Service Domain: $CUSTOM_DOMAIN"
    echo ""

    # Step 1: Get the App Runner Service ARN from its name
    log_info "🔍 Step 1: Finding App Runner service ARN..."
    local service_name="fs-api-$ACCOUNT_ID"
    local service_arn
    service_arn=$(aws apprunner list-services --region "$REGION" | jq -r --arg name "$service_name" '.ServiceSummaryList[] | select(.ServiceName == $name) | .ServiceArn')

    if [ -z "$service_arn" ]; then
        log_error "Could not find App Runner service with name '$service_name'"
        exit 1
    fi
    log_success "✅ Found App Runner Service ARN."
    echo ""

    # Step 2: Get the ACM Certificate ARN from the domain name
    log_info "🔍 Step 2: Finding ACM certificate for '$CUSTOM_DOMAIN'..."
    local certificate_arn
    certificate_arn=$(aws acm list-certificates --region "$REGION" --certificate-statuses ISSUED | jq -r --arg domain "$CUSTOM_DOMAIN" '.CertificateSummaryList[] | select(.DomainName == $domain) | .CertificateArn')

    if [ -z "$certificate_arn" ]; then
        log_error "Could not find an ISSUED ACM certificate for '$CUSTOM_DOMAIN' in region '$REGION'."
        log_error "Please ensure the certificate exists and is in the correct region."
        exit 1
    fi
    log_success "✅ Found ACM Certificate ARN."
    echo ""

    # Step 3: Forcefully disassociate any existing domain to ensure a clean state
    log_info "🔍 Step 3: Checking for and removing any existing domain associations..."
    local existing_domain
    existing_domain=$(aws apprunner describe-custom-domains --service-arn "$service_arn" --region "$REGION" | jq -r --arg domain "$CUSTOM_DOMAIN" '.CustomDomains[] | select(.DomainName == $domain)')

    if [ -n "$existing_domain" ]; then
        log_warning "🔥 Found an existing domain association. Deleting it now to ensure a clean start..."
        if ! aws apprunner disassociate-custom-domain --service-arn "$service_arn" --domain-name "$CUSTOM_DOMAIN" --region "$REGION" > /dev/null; then
            log_error "Failed to send disassociation request. Please check App Runner permissions."
            exit 1
        fi

        log_info "⏳ Waiting for the old association to be fully removed..."
        while true; do
            local check_domain
            check_domain=$(aws apprunner describe-custom-domains --service-arn "$service_arn" --region "$REGION" | jq -r --arg domain "$CUSTOM_DOMAIN" '.CustomDomains[] | select(.DomainName == $domain)')
            if [ -z "$check_domain" ]; then
                log_success "✅ Old association successfully removed."
                break
            fi
            log_info "Still waiting for disassociation... sleeping for 20 seconds."
            sleep 20
        done
    else
        log_info "No existing association found. Proceeding with a fresh start."
    fi
    
    # Now, always create a new, clean association
    log_info "Creating a new domain association..."
    if ! aws apprunner associate-custom-domain --service-arn "$service_arn" --domain-name "$CUSTOM_DOMAIN" --region "$REGION" > /dev/null; then
        log_error "Failed to start the new custom domain association."
        exit 1
    fi
    log_info "✅ New association request sent."
    echo ""

    # Step 4: Clean up old validation records from Route 53 to prevent conflicts
    log_info "🧹 Step 4: Cleaning up any stale DNS validation records..."
    local hosted_zone_id
    hosted_zone_id=$(aws route53 list-hosted-zones-by-name --dns-name "$HOSTED_ZONE_NAME." --max-items 1 | jq -r '.HostedZones[0].Id' | sed 's/^\/hostedzone\///')
    
    if [ -z "$hosted_zone_id" ]; then
        log_error "Could not find Hosted Zone for '$HOSTED_ZONE_NAME'"
        exit 1
    fi

    local old_records
    old_records=$(aws route53 list-resource-record-sets --hosted-zone-id "$hosted_zone_id" | jq -c --arg domain "$HOSTED_ZONE_NAME" '[.ResourceRecordSets[] | select(.Name | startswith("_acme-challenge.") and endswith("." + $domain + ".")) | {Action: "DELETE", ResourceRecordSet: .}]')

    if [ "$(echo "$old_records" | jq 'length')" -gt 0 ]; then
        log_warning "Found and deleting stale _acme-challenge records..."
        local delete_batch
        delete_batch=$(jq -n --argjson changes "$old_records" '{Changes: $changes, Comment: "Deleting stale App Runner validation records"}')
        aws route53 change-resource-record-sets --hosted-zone-id "$hosted_zone_id" --change-batch "$delete_batch"
        log_success "✅ Stale records deleted."
    else
        log_info "No stale validation records found."
    fi
    echo ""

    # Step 5: Wait for the validation records to be generated by AWS
    log_info "⏳ Step 5: Waiting for DNS validation records..."
    local domain_description
    local validation_records
    while true; do
        domain_description=$(aws apprunner describe-custom-domains --service-arn "$service_arn" --region "$REGION")
        validation_records=$(echo "$domain_description" | jq -c '.CustomDomains[0].CertificateValidationRecords')

        if [ "$validation_records" != "null" ] && [ "$(echo "$validation_records" | jq 'length')" -gt 0 ]; then
            log_success "✅ DNS validation records are now available."
            break
        fi

        log_info "Still waiting for records... sleeping for 30 seconds."
        sleep 30
    done
    echo ""

    # Step 6: Create the DNS validation records in Route 53
    log_info "📡 Step 6: Creating DNS validation records in Route 53..."
    local hosted_zone_id
    hosted_zone_id=$(aws route53 list-hosted-zones-by-name --dns-name "$HOSTED_ZONE_NAME." --max-items 1 | jq -r '.HostedZones[0].Id' | sed 's/^\/hostedzone\///')

    if [ -z "$hosted_zone_id" ]; then
        log_error "Could not find Hosted Zone for '$HOSTED_ZONE_NAME'"
        exit 1
    fi
    log_success "Found Hosted Zone ID: $hosted_zone_id"

    local changes_json
    changes_json=$(echo "$validation_records" | jq '[.[] | {Action: "UPSERT", ResourceRecordSet: {Name: .Name, Type: .Type, ResourceRecords: [{Value: .Value}], TTL: 300}}]')
    local change_batch_json
    change_batch_json=$(jq -n --argjson changes "$changes_json" '{Changes: $changes, Comment: "App Runner custom domain validation for '$CUSTOM_DOMAIN'"}')

    aws route53 change-resource-record-sets \
        --hosted-zone-id "$hosted_zone_id" \
        --change-batch "$change_batch_json"
    log_success "✅ DNS validation records submitted to Route 53."
    echo ""

    # Step 7: Wait for AWS to validate the domain and activate it
    log_info "⏳ Step 7: Waiting for domain validation and activation... This can take some time."
    local status
    local dns_target
    while true; do
        domain_description=$(aws apprunner describe-custom-domains --service-arn "$service_arn" --region "$REGION")
        status=$(echo "$domain_description" | jq -r '.CustomDomains[0].Status' | tr '[:upper:]' '[:lower:]')
        dns_target=$(echo "$domain_description" | jq -r '.CustomDomains[0].DNSTarget')

        if [ "$status" == "active" ] && [ "$dns_target" != "null" ] && [ -n "$dns_target" ]; then
            log_success "✅ Custom domain is now ACTIVE and DNSTarget is available!"
            break
        elif [ "$status" == "failed" ]; then
            log_error "❌ Custom domain association FAILED."
            log_error "Details: $(echo "$domain_description" | jq '.CustomDomains[0]')"
            exit 1
        fi
        
        log_info "Current status: $status. DNSTarget available: [${dns_target:-'no'}]. Checking again in 30 seconds..."
        sleep 30
    done
    echo ""

    # Step 8: Create the final DNS record to point the custom domain to the App Runner service
    log_info "📡 Step 8: Creating final DNS record to point '$CUSTOM_DOMAIN' to the App Runner service..."
    log_info "(Using 'UPSERT' to automatically replace any existing CNAME record with the correct value)"
    local final_change_batch
    final_change_batch=$(cat <<EOF
{
  "Comment": "Point custom domain to App Runner service for '$CUSTOM_DOMAIN'",
  "Changes": [
    {
      "Action": "UPSERT",
      "ResourceRecordSet": {
        "Name": "$CUSTOM_DOMAIN",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [
          {
            "Value": "$dns_target"
          }
        ]
      }
    }
  ]
}
EOF
)

    aws route53 change-resource-record-sets \
        --hosted-zone-id "$hosted_zone_id" \
        --change-batch "$final_change_batch"
    log_success "✅ Final DNS record created successfully."
    echo ""
    log_success "🎉 Custom domain setup complete! Your service should be available at https://$CUSTOM_DOMAIN shortly."
}

# Run the main function
main "$@" 