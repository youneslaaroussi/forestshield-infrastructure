<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ pnpm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).

# 🌳 ForestShield - AWS-Powered Deforestation Detection

**ForestShield** is a production-ready AWS-native application that monitors deforestation in real-time using Sentinel-2 satellite imagery and machine learning.

## 🎯 Project Overview

ForestShield targets the **Amazon Rainforest** (specifically Pará, Brazil near Novo Progresso) - one of the world's most critical deforestation hotspots. Using Sentinel-2 satellite data from AWS Open Data Registry, we detect forest loss through NDVI analysis.

### Target Region
- **Location**: Pará, Brazil (-6.0°, -53.0°)
- **Area**: Novo Progresso deforestation hotspot
- **Time Period**: Configurable date ranges for analysis

## 🚀 Implementation Status

### ✅ Production Ready - No Demo Mode
- [x] **Real Sentinel-2 data processing** - Streams satellite bands directly from AWS
- [x] **Real NDVI calculations** - Processes pixel data in memory-efficient chunks using Python, GDAL, and Rasterio
- [x] **Real AWS integrations** - S3, SageMaker, Lambda, Step Functions, SNS
- [x] **Real deforestation detection** - Analyzes vegetation changes over time
- [x] **Real alerts** - SNS notifications for significant forest loss
- [x] **Production deployment** - CloudFormation and shell scripts for infrastructure as code

## 🛠️ Technology Stack

### Backend
- **NestJS** - Enterprise microservices framework
- **TypeScript** - Type-safe development
- **AWS SDK v3** - Latest AWS service integrations

### AWS Services
- **S3** - Satellite data storage and processing
- **SageMaker** - K-means clustering for vegetation classification
- **Lambda** - Serverless NDVI processing (Python 3.11 + lambgeo layer)
- **Step Functions** - Workflow orchestration
- **SNS** - Real-time deforestation alerts
- **CloudWatch** - Monitoring and logging

### Data Processing
- **Sentinel-2 L2A** - Real satellite imagery from AWS Open Data Registry
- **STAC API** - Satellite imagery search and metadata
- **Python** - Core data processing language
- **GDAL & Rasterio** - High-performance, memory-efficient geospatial data processing
- **NDVI Analysis** - Vegetation health calculation
- **Change Detection** - Time-series deforestation analysis

## 🚀 Quick Start

### Prerequisites
- **AWS Account** with configured credentials (`aws configure`)
- **Node.js 18+** and **pnpm**
- **Docker** - For building the Python Lambda deployment package
- **AWS CLI v2** configured with your credentials

### Installation

**1. Install Node.js Dependencies:**
```bash
pnpm install
```

**2. Set up Environment:**
```bash
# Set up environment variables (see Environment Configuration)
cp .env.example .env
# Edit .env with your AWS account details
```

**3. Start the server (for local development/testing):**
```bash
pnpm run start:dev
```

### Environment Configuration
Create a `.env` file with your AWS configuration. You can get your Account ID by running `aws sts get-caller-identity --query Account --output text`.

```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# S3 Buckets (the deploy script will create these)
PROCESSED_DATA_BUCKET=forestshield-processed-data-{account-id}

# IAM Roles (the deploy script will create these)
SAGEMAKER_ROLE_ARN=arn:aws:iam::{account-id}:role/ForestShieldSageMakerRole

# SNS Topics (the deploy script will create these)
SNS_DEFORESTATION_TOPIC_ARN=arn:aws:sns:us-west-2:{account-id}:deforestation-alerts

# Step Functions (the deploy script will create this)
STEP_FUNCTIONS_STATE_MACHINE_ARN=arn:aws:states:us-west-2:{account-id}:stateMachine:forestshield-pipeline
```

### Deploy AWS Infrastructure

The entire backend, including the Python Lambda function, is deployed with a single script.

**Deployment:**
```bash
# Make the deployment script executable and run it
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Create all necessary S3 buckets and IAM roles.
2. Build the Java Lambda functions.
3. Use Docker to build the Python `vegetation-analyzer` Lambda function with all its dependencies.
4. Deploy all Lambda functions.
5. Create the Step Functions state machine and SNS topic.
6. Generate a `.env.production` file with the ARNs of the created resources.

## 🌐 API Endpoints

### Core Processing Endpoints
```bash
# System health check
GET /sentinel/health

# Search for satellite images
POST /sentinel/search
{
  "latitude": -6.0,
  "longitude": -53.0,
  "startDate": "2022-06-01",
  "endDate": "2022-09-01",
  "cloudCover": 20
}

# Analyze region for deforestation (this is the main endpoint)
POST /sentinel/analyze-region
{
  "latitude": -6.0,
  "longitude": -53.0,
  "startDate": "2022-06-01",
  "endDate": "2022-09-01",
  "cloudCover": 20
}
```

### Example Response
```json
{
  "success": true,
  "region": {
    "coordinates": [-6, -53],
    "timeRange": "2022-06-01 to 2022-09-01"
  },
  "imagesFound": 22,
  "analysisResults": {
    "deforestationPercentage": 7.21,
    "alertMessage": "⚠️ MODERATE DEFORESTATION: 7.2% vegetation loss detected",
    "timeSeriesData": [
      {
        "date": "2022-08-16T13:54:23.491Z",
        "vegetationPercentage": 98.98
      },
      {
        "date": "2022-08-31T13:54:11.956Z",
        "vegetationPercentage": 91.77
      }
    ]
  },
  "processingTime": "96.3s"
}
```

## 📊 Real Processing Capabilities

### ✅ Satellite Data Processing
- **Real-time image search** from AWS Sentinel-2 Open Data Registry
- **Band data streaming** (B04 Red, B08 NIR) directly into memory for NDVI calculation
- **Cloud filtering** to ensure clear imagery
- **Geographic filtering** for specific regions

### ✅ NDVI Analysis
- **Memory-efficient chunked processing** using Python, GDAL, and Rasterio
- **Pixel-level vegetation health calculation** ((NIR - Red) / (NIR + Red))
- **Statistical analysis** (mean, min, max, standard deviation) over large areas without running out of memory.

### ✅ Change Detection
- **Time-series analysis** comparing multiple dates
- **Deforestation percentage** calculation based on vegetation loss
- **Threshold-based alerting** (>5% triggers moderate alert, >10% critical)
- **Trend analysis** for vegetation loss patterns

### ✅ AWS Integration
- **S3 storage** for processed results and temporary files
- **SageMaker processing** for K-means clustering (if enabled)
- **SNS alerts** for real-time notifications
- **Step Functions** for workflow orchestration
- **CloudWatch** for monitoring and logging

## 🔧 Development vs Production

### Production Mode (Default)
- **Real AWS services** - All operations use actual AWS resources
- **Real satellite data** - Downloads and processes actual Sentinel-2 imagery
- **Real costs** - AWS charges apply for compute, storage, and data transfer
- **Real alerts** - SNS notifications sent to configured email/SMS

### Error Handling
- **No fallbacks** - System fails fast if AWS services are unavailable
- **Explicit errors** - Clear error messages for missing configuration
- **Required environment variables** - System won't start without proper AWS setup

## 💰 Cost Estimation

### AWS Service Costs (Monthly)
- **Lambda executions**: ~$10-20 (depending on processing volume)
- **S3 storage**: ~$5-15 (processed images and results)
- **SageMaker processing**: ~$20-50 (K-means clustering jobs)
- **SNS notifications**: ~$1-3 (alert messages)
- **Data transfer**: ~$5-10 (Sentinel-2 band downloads)

**Total estimated cost**: $40-100/month for regular monitoring

## 🌍 Impact & Applications

### Environmental Monitoring
- **Early warning system** for illegal deforestation
- **Conservation support** for protected area monitoring
- **Research data** for deforestation pattern analysis
- **Policy support** for environmental regulation enforcement

### Technical Innovation
- **Serverless architecture** for cost-effective scaling
- **Real-time processing** for immediate threat detection
- **Open data utilization** leveraging AWS public datasets
- **Machine learning integration** for automated pattern recognition

## Useful commands

View logs: aws logs tail /aws/lambda/forestshield-vegetation-analyzer

# Disable termination protection on the failed stack
aws cloudformation update-termination-protection --no-enable-termination-protection --stack-name forestshield-infratructure --region us-west-2

# Delete the failed stack
aws cloudformation delete-stack --stack-name forestshield-infratructure --region us-west-2

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name forestshield-infratructure --region us-west-2

# update a single lambda
cd lambda-functions/my-function
bash build.sh
aws lambda update-function-code --function-name forestshield-k-selector --zip-file fileb://lambda-functions/k-selector/k-selector-lambda.zip

# or just run this
deploy.sh lambdas results-consolidator -u