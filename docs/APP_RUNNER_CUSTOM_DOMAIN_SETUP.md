# AWS App Runner Custom Domain Setup Guide

This guide walks you through setting up a custom domain for AWS App Runner using AWS CLI commands.

## Prerequisites

- ✅ AWS CLI installed and configured
- ✅ Domain registered and hosted in Route 53 (or DNS provider)
- ✅ App Runner service already deployed
- ✅ Proper IAM permissions for App Runner and Route 53

## Step 1: Get Your App Runner Service Information

First, find your App Runner service ARN:

```bash
# List all App Runner services
aws apprunner list-services --region us-west-2

# Example output:
# {
#     "ServiceSummaryList": [
#         {
#             "ServiceName": "forestshield-api",
#             "ServiceId": "b0dbdbb1d49340b2a0b8107174d811a5",
#             "ServiceArn": "arn:aws:apprunner:us-west-2:381492060635:service/forestshield-api/b0dbdbb1d49340b2a0b8107174d811a5",
#             "ServiceUrl": "sb5ym6yws5.us-west-2.awsapprunner.com",
#             "Status": "RUNNING"
#         }
#     ]
# }
```

**Save the following values:**
- `ServiceArn`: `arn:aws:apprunner:us-west-2:ACCOUNT_ID:service/SERVICE_NAME/SERVICE_ID`
- `ServiceUrl`: `RANDOM_ID.us-west-2.awsapprunner.com`

## Step 2: Get Your Route 53 Hosted Zone ID

```bash
# List hosted zones to find your domain
aws route53 list-hosted-zones --query "HostedZones[?Name=='yourdomain.com.'].{Name:Name,Id:Id}" --output table

# Example output:
# +---------------------------+------------------+
# |            Id             |       Name       |
# +---------------------------+------------------+
# |  /hostedzone/Z0936583AGYAQUWBUFTD  |  forestshieldapp.com.  |
# +---------------------------+------------------+
```

**Save the Hosted Zone ID:** `Z0936583AGYAQUWBUFTD` (without the `/hostedzone/` prefix)

## Step 3: Associate Custom Domain with App Runner

```bash
# Replace variables with your actual values
SERVICE_ARN="arn:aws:apprunner:us-west-2:ACCOUNT_ID:service/SERVICE_NAME/SERVICE_ID"
CUSTOM_DOMAIN="api.yourdomain.com"
REGION="us-west-2"

# Associate the custom domain
aws apprunner associate-custom-domain \
  --service-arn "$SERVICE_ARN" \
  --domain-name "$CUSTOM_DOMAIN" \
  --region "$REGION"
```

**Expected Output:**
```json
{
    "DNSTarget": "randomid.us-west-2.awsapprunner.com",
    "ServiceArn": "arn:aws:apprunner:us-west-2:381492060635:service/your-service/serviceid",
    "CustomDomain": {
        "DomainName": "api.yourdomain.com",
        "EnableWWWSubdomain": true,
        "Status": "creating"
    },
    "VpcDNSTargets": []
}
```

## Step 4: Create Primary CNAME Record

```bash
# Replace variables with your actual values
HOSTED_ZONE_ID="Z0936583AGYAQUWBUFTD"
CUSTOM_DOMAIN="api.yourdomain.com"
DNS_TARGET="randomid.us-west-2.awsapprunner.com"  # From Step 3 output

# Create the primary CNAME record
aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"$CUSTOM_DOMAIN\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"$DNS_TARGET\"}]
      }
    }]
  }"
```

## Step 5: Get Certificate Validation Records

```bash
# Check domain status and get validation records
aws apprunner describe-custom-domains \
  --service-arn "$SERVICE_ARN" \
  --region "$REGION"
```

**Look for the `CertificateValidationRecords` section:**
```json
{
    "CustomDomains": [
        {
            "DomainName": "api.yourdomain.com",
            "Status": "pending_certificate_dns_validation",
            "CertificateValidationRecords": [
                {
                    "Name": "_validation1.api.yourdomain.com.",
                    "Type": "CNAME",
                    "Value": "_validation1.acm-validations.aws.",
                    "Status": "PENDING_VALIDATION"
                },
                {
                    "Name": "_validation2.www.api.yourdomain.com.",
                    "Type": "CNAME", 
                    "Value": "_validation2.acm-validations.aws.",
                    "Status": "PENDING_VALIDATION"
                }
            ]
        }
    ]
}
```

## Step 6: Add Certificate Validation Records

```bash
# Extract validation records from the previous command output
# You'll need to create one CNAME record for each validation record

# Example for multiple validation records:
aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "_validation1.api.yourdomain.com.",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "_validation1.acm-validations.aws."}]
        }
      },
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "_validation2.www.api.yourdomain.com.",
          "Type": "CNAME",
          "TTL": 300,
          "ResourceRecords": [{"Value": "_validation2.acm-validations.aws."}]
        }
      }
    ]
  }'
```

## Step 7: Monitor Domain Status

```bash
# Check domain validation status
aws apprunner describe-custom-domains \
  --service-arn "$SERVICE_ARN" \
  --region "$REGION" \
  --query "CustomDomains[0].Status" \
  --output text

# Possible statuses:
# - creating
# - pending_certificate_dns_validation
# - binding_certificate
# - active
# - create_failed
```

**Keep checking until status becomes `active` (usually 10-45 minutes)**

## Step 8: Verify Domain Works

```bash
# Test the custom domain
curl https://api.yourdomain.com/health

# Compare with direct App Runner URL
curl https://randomid.us-west-2.awsapprunner.com/health
```

## Complete Example Script

```bash
#!/bin/bash

# Configuration
SERVICE_NAME="your-service-name"
CUSTOM_DOMAIN="api.yourdomain.com"
HOSTED_ZONE_ID="YOUR_HOSTED_ZONE_ID"
REGION="us-west-2"

echo "🚀 Setting up custom domain for App Runner..."

# Step 1: Get service ARN
echo "📋 Getting App Runner service information..."
SERVICE_ARN=$(aws apprunner list-services --region "$REGION" --query "ServiceSummaryList[?ServiceName=='$SERVICE_NAME'].ServiceArn" --output text)
echo "   Service ARN: $SERVICE_ARN"

# Step 2: Associate custom domain
echo "🔗 Associating custom domain..."
DOMAIN_RESULT=$(aws apprunner associate-custom-domain \
  --service-arn "$SERVICE_ARN" \
  --domain-name "$CUSTOM_DOMAIN" \
  --region "$REGION")

DNS_TARGET=$(echo "$DOMAIN_RESULT" | jq -r '.DNSTarget')
echo "   DNS Target: $DNS_TARGET"

# Step 3: Create primary CNAME record
echo "🌐 Creating primary CNAME record..."
aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch "{
    \"Changes\": [{
      \"Action\": \"CREATE\",
      \"ResourceRecordSet\": {
        \"Name\": \"$CUSTOM_DOMAIN\",
        \"Type\": \"CNAME\",
        \"TTL\": 300,
        \"ResourceRecords\": [{\"Value\": \"$DNS_TARGET\"}]
      }
    }]
  }"

echo "✅ Primary CNAME record created"
echo "⏳ Waiting for certificate validation records..."
echo "   Run the following command to get validation records:"
echo "   aws apprunner describe-custom-domains --service-arn \"$SERVICE_ARN\" --region \"$REGION\""
echo ""
echo "🔍 Monitor status with:"
echo "   aws apprunner describe-custom-domains --service-arn \"$SERVICE_ARN\" --region \"$REGION\" --query \"CustomDomains[0].Status\" --output text"
```

## Troubleshooting

### Domain Status Stuck in `pending_certificate_dns_validation`

1. **Verify DNS records are correct:**
   ```bash
   # Check CNAME records
   dig CNAME api.yourdomain.com
   dig CNAME _validation.api.yourdomain.com
   ```

2. **DNS propagation delay:**
   - Wait 10-15 minutes for DNS propagation
   - Check from different locations: `nslookup api.yourdomain.com 8.8.8.8`

3. **Re-check validation records:**
   ```bash
   aws apprunner describe-custom-domains --service-arn "$SERVICE_ARN" --region "$REGION"
   ```

### Domain Status Shows `create_failed`

1. **Check domain ownership:**
   - Ensure domain is properly configured in Route 53
   - Verify hosted zone permissions

2. **Retry association:**
   ```bash
   # Disassociate first
   aws apprunner disassociate-custom-domain --service-arn "$SERVICE_ARN" --domain-name "$CUSTOM_DOMAIN" --region "$REGION"
   
   # Wait a few minutes, then retry association
   aws apprunner associate-custom-domain --service-arn "$SERVICE_ARN" --domain-name "$CUSTOM_DOMAIN" --region "$REGION"
   ```

### DNS Records Management

```bash
# List all DNS records for your domain
aws route53 list-resource-record-sets --hosted-zone-id "$HOSTED_ZONE_ID" --query "ResourceRecordSets[?Type=='CNAME']"

# Delete a DNS record if needed
aws route53 change-resource-record-sets \
  --hosted-zone-id "$HOSTED_ZONE_ID" \
  --change-batch '{
    "Changes": [{
      "Action": "DELETE",
      "ResourceRecordSet": {
        "Name": "api.yourdomain.com",
        "Type": "CNAME",
        "TTL": 300,
        "ResourceRecords": [{"Value": "old-target.com"}]
      }
    }]
  }'
```

## Security Considerations

1. **Use TTL 300 (5 minutes)** for validation records for faster updates
2. **Increase TTL to 3600 (1 hour)** for production CNAME records after validation
3. **Enable HTTPS only** - App Runner automatically handles SSL certificates
4. **Monitor certificate expiration** - AWS ACM auto-renews certificates

## Cost Considerations

- **App Runner custom domains**: No additional cost
- **Route 53 DNS queries**: $0.40 per million queries
- **ACM certificates**: Free for App Runner use

---

**Created:** $(date)
**Last Updated:** $(date)
**Version:** 1.0 