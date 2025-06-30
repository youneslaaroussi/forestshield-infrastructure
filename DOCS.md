# ForestShield: Definitive Technical Specification & System Architecture
## Version 1.0
### Last Updated: 2023-10-27

---

## **TABLE OF CONTENTS**

1.  [**Introduction & Executive Summary**](#1-introduction--executive-summary)
    1.1. [System Purpose](#11-system-purpose)
    1.2. [Core Architectural Pillars](#12-core-architectural-pillars)
2.  [**Core Scientific & Mathematical Principles**](#2-core-scientific--mathematical-principles)
    2.1. [Normalized Difference Vegetation Index (NDVI)](#21-normalized-difference-vegetation-index-ndvi)
    2.2. [K-means Clustering for Land Cover Classification](#22-k-means-clustering-for-land-cover-classification)
    2.3. [Optimal Cluster Selection: The Elbow Method](#23-optimal-cluster-selection-the-elbow-method)
3.  [**Definitive Infrastructure Specification (`cloudformation.yaml`)**](#3-definitive-infrastructure-specification-cloudformationyaml)
    3.1. [Networking Layer (AWS VPC)](#31-networking-layer-aws-vpc)
    3.2. [Application & API Layer (AWS App Runner)](#32-application--api-layer-aws-app-runner)
    3.3. [Data & Analytics Layer](#33-data--analytics-layer)
    3.4. [Security & Permissions (AWS IAM)](#34-security--permissions-aws-iam)
4.  [**Application Logic & Workflow Internals (Source Code Analysis)**](#4-application-logic--workflow-internals-source-code-analysis)
    4.1. [Primary Workflow: `DeforestationDetectionWorkflow` Deep Dive](#41-primary-workflow-deforestationdetectionworkflow-deep-dive)
    4.2. [Lambda Function Internals & Algorithms](#42-lambda-function-internals--algorithms)
    4.3. [API Service Layer Logic (NestJS)](#43-api-service-layer-logic-nestjs)
5.  [**Data Models & Schemas**](#5-data-models--schemas)
    5.1. [S3 Data Lake Object Schemas](#51-s3-data-lake-object-schemas)
    5.2. [DynamoDB Table Schemas](#52-dynamodb-table-schemas)

---

## **1. Introduction & Executive Summary**

### **1.1. System Purpose**

ForestShield is a fully serverless, cloud-native platform designed for the automated monitoring and analysis of deforestation using Sentinel-2 satellite imagery. It is architected around asynchronous, event-driven principles to create a scalable, resilient, and cost-effective system capable of processing large geospatial datasets. The entire infrastructure is defined declaratively using AWS CloudFormation, ensuring reproducibility and version control of the environment.

### **1.2. Core Architectural Pillars**

-   **Serverless First**: All components, from the API layer to the compute and orchestration engines, leverage managed AWS services (App Runner, Lambda, Step Functions). This design minimizes operational overhead associated with managing servers, patching, and scaling.
-   **API-Driven Orchestration**: A central NestJS application, hosted on AWS App Runner, serves as the primary control plane. It exposes a RESTful API for user interaction and is responsible for initiating backend workflows, but it delegates all long-running or computationally intensive tasks.
-   **Decoupled, Asynchronous Processing**: The core analysis pipeline is orchestrated by an AWS Step Functions state machine. This critically decouples the synchronous API from the long-running analysis process (which can take many minutes), ensuring the API remains responsive. The API initiates a workflow and can later query its status, a standard asynchronous backend processing pattern.
-   **Function-as-a-Service (FaaS) Compute**: All computational tasks are encapsulated within single-purpose AWS Lambda functions. This allows for the independent scaling, resource allocation (memory/timeout), and maintenance of each logical task in the pipeline.
-   **Region-Aware Machine Learning**: The system is designed to handle analyses across different global biomes. The workflow and data models are explicitly aware of the `region` and `tile_id` of the satellite imagery, ensuring that machine learning models are trained and applied only to their relevant geographical areas.

---

## **2. Core Scientific & Mathematical Principles**

### **2.1. Normalized Difference Vegetation Index (NDVI)**

The foundational metric for measuring vegetation health is the NDVI. It is calculated by the `vegetation-analyzer` Lambda function on a per-pixel basis using the reflectance values from the Red and Near-Infrared (NIR) spectral bands of the Sentinel-2 satellite.

The mathematical formula is:

\[ \text{NDVI} = \frac{(\text{NIR} - \text{Red})}{(\text{NIR} + \text{Red})} \]

-   **NIR**: Reflectance value from the Sentinel-2 B08 band.
-   **Red**: Reflectance value from the Sentinel-2 B04 band.

The resulting values range from **-1.0 to +1.0**. Higher positive values (typically > 0.2) indicate healthy, dense vegetation, as chlorophyll strongly reflects NIR light and absorbs red light. Values near zero or below indicate non-vegetated surfaces like soil, water, or impervious surfaces (roads, buildings).

### **2.2. K-means Clustering for Land Cover Classification**

The system employs K-means clustering within Amazon SageMaker as an unsupervised machine learning technique to segment the multi-dimensional pixel data into distinct land-cover classes. Each pixel is represented as a 5-dimensional vector: `[NDVI, Red, NIR, Latitude, Longitude]`. The algorithm groups these vectors into *K* clusters by minimizing the within-cluster sum of squares.

### **2.3. Optimal Cluster Selection: The Elbow Method**

A key challenge in K-means is choosing the optimal number of clusters, *K*. The `k-selector` Lambda function automates this by implementing the **Elbow Method**. This method involves running the K-means algorithm for a range of *K* values and calculating the Sum of Squared Errors (SSE) for each run.

The SSE is defined as:

\[ \text{SSE} = \sum_{i=1}^{k} \sum_{x \in C_i} \text{dist}(x, \mu_i)^2 \]

-   *k* is the number of clusters.
-   *C_i* is the *i*-th cluster.
-   *x* is a data point (a 5-D pixel vector) in cluster *C_i*.
-   *μ_i* is the centroid (mean vector) of cluster *C_i*.
-   `dist` is the Euclidean distance between the point and the centroid.

When the SSE is plotted against *K*, the plot typically shows a sharp decrease in SSE as *K* increases, followed by a flattening of the curve. The "elbow" of this curve represents the point of diminishing returns, where adding another cluster does not significantly reduce the SSE. The `k-selector` function programmatically identifies this point and selects it as the optimal *K*.

---

## **3. Definitive Infrastructure Specification (`cloudformation.yaml`)**

This section details every AWS resource provisioned by the CloudFormation template.

### **3.1. Networking Layer (AWS VPC)**

-   **`ForestShieldVPC` (`AWS::EC2::VPC`)**: The foundational network boundary with a CIDR block of `10.0.0.0/16`.
-   **Subnets & Routing**:
    -   **Public Subnets**: `PublicSubnet1` (`10.0.0.0/24`) and `PublicSubnet2` (`10.0.3.0/24`) are deployed across two Availability Zones for high availability. They are associated with the `PublicRouteTable`, which has a default route (`0.0.0.0/0`) pointed to the `InternetGateway`. This provides direct internet egress and allows them to host public-facing resources like NAT Gateways.
    -   **Private Subnets**: `PrivateSubnet1` (`10.0.1.0/24`) and `PrivateSubnet2` (`10.0.2.0/24`) are also deployed across two AZs. They use `PrivateRouteTable1` and `PrivateRouteTable2`, which route default traffic (`0.0.0.0/0`) to the NAT Gateways. This allows resources within them (like the Redis cluster) to initiate outbound connections (e.g., for security updates) without being publicly addressable.
-   **Gateways**:
    -   **`InternetGateway`**: The primary internet ingress/egress point for the VPC.
    -   **`NatGateway1` & `NatGateway2`**: Deployed in the public subnets and associated with Elastic IPs (`NatGatewayEIP1`, `NatGatewayEIP2`) to provide stable, managed network address translation for the private subnets.
-   **Security Groups**:
    -   **`AppRunnerSecurityGroup`**: Secures the App Runner service's VPC Connector. Its egress rules are critical:
        1.  Allows outbound TCP traffic on port `6379` exclusively to the `RedisSecurityGroup`.
        2.  Allows all other outbound traffic (`-1`) to `0.0.0.0/0` for accessing public AWS APIs (like S3, DynamoDB, Lambda).
    -   **`RedisSecurityGroup`**: A stateful firewall for the ElastiCache cluster. It has **no Egress rules** by default.
    -   **`AppRunnerToRedisIngressRule`**: A dedicated ingress rule on the `RedisSecurityGroup` that allows inbound TCP traffic on port `6379` *only* from the `AppRunnerSecurityGroup`. This creates a tightly controlled, unidirectional access path from the API layer to the cache, following the principle of least privilege.

### **3.2. Application & API Layer (AWS App Runner)**

-   **`APIService` (`AWS::AppRunner::Service`)**:
    -   **Source**: A Docker image identified by the URI `${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/forestshield-api:latest`. The `AppRunnerECRAccessRole` grants App Runner permission to pull from this ECR repository.
    -   **Instance Configuration**: `Cpu: '1 vCPU'`, `Memory: '2 GB'`. The service runs under the identity of the `AppRunnerInstanceRole`.
    -   **Networking**: Egress is explicitly configured to be of type `VPC` and uses the `VpcConnector`. This is a critical security configuration that forces all outbound traffic from the API container through the VPC's defined routing and security rules.
    -   **Health Check**: Actively monitors the `/health` path on port `3000` of the container every 10 seconds.
-   **`AppRunnerAutoScaling`**: A dedicated auto-scaling configuration that allows the service to scale from a `MinSize: 1` to a `MaxSize: 10`, with each instance handling up to `MaxConcurrency: 100` requests.

### **3.3. Data & Analytics Layer**

-   **S3 Buckets**:
    -   **`ProcessedDataBucket`**: Versioning is `Enabled` to protect against accidental overwrites and to maintain a history of processed data artifacts. This is the primary data lake.
    -   **`ModelsBucket`**: Versioning is `Enabled` to maintain a full history of all trained machine learning models.
    -   **`TempBucket`**: A `LifecycleConfiguration` rule automatically purges objects older than 7 days to manage costs.
-   **DynamoDB Tables**:
    -   **Billing Mode**: Both tables use `PROVISIONED` throughput with 5 WCUs and 5 RCUs, indicating a predictable and moderate workload.
    -   **`MonitoredRegionsTable`**: A simple key-value store with `regionId` (String) as the HASH key.
    -   **`DeforestationAlertsTable`**: Features a **Global Secondary Index (GSI)** named `RegionIdIndex` on the `regionId` attribute. This GSI is essential for efficiently querying the alert history for a specific monitored region, a core feature of the dashboard. Without it, the application would have to perform a costly full-table `Scan` operation.
-   **ElastiCache for Redis**:
    -   **`RedisCluster` (`AWS::ElastiCache::ReplicationGroup`)**: A `cache.t3.micro` Redis 7.0 cluster with `NumCacheClusters: 2`.
    -   **High Availability**: `MultiAZEnabled` and `AutomaticFailoverEnabled` are both `true`. This creates a primary and replica node in different AZs. If the primary node fails, ElastiCache will automatically promote the replica to primary, providing resilience.
    -   **Security**: `AtRestEncryptionEnabled` and `TransitEncryptionEnabled` are both `true`, ensuring data is encrypted both on disk and in transit.
-   **Glue & Athena**:
    -   **`GeospatialDataTable`**: An external table defined with a `StorageDescriptor` that uses `org.openx.data.jsonserde.JsonSerDe` to parse the JSON-formatted pixel data files stored in S3. It is partitioned by `year`, `month`, and `day`, which dramatically improves query performance and reduces cost by allowing Athena to prune partitions and avoid scanning irrelevant data.
    -   **`GeospatialDataCrawler`**: A scheduled crawler (`cron(0 1 * * ? *)`) that automatically discovers new data partitions in S3.
    -   **`CrawlerStartFunction` (`AWS::CloudFormation::CustomResource`)**: A Lambda-backed custom resource that programmatically triggers the `GeospatialDataCrawler` upon stack creation or update. This ensures the Athena table is immediately populated and queryable after deployment without manual intervention.

### **3.4. Security & Permissions (AWS IAM)**

-   **`LambdaExecutionRole`**: Assumed by Lambda and SageMaker. Contains managed policies for basic execution, S3 full access, and SageMaker full access. Critically, its inline policy grants `iam:PassRole` on the `SageMakerExecutionRole`, allowing a Lambda function to grant SageMaker permission to act on its behalf.
-   **`SageMakerExecutionRole`**: Assumed by the SageMaker service. Grants the training jobs permission to read from the `processed-data` bucket and write to the `models` bucket.
-   **`StepFunctionsExecutionRole`**: Assumed by Step Functions. A powerful role that allows the state machine to invoke Lambda functions (`lambda:InvokeFunction`), publish to SNS, and start SageMaker jobs. It also has `iam:PassRole` on the `SageMakerExecutionRole`.
-   **`AppRunnerInstanceRole`**: Assumed by the App Runner tasks. The inline `ForestShieldAPIAccess` policy grants specific permissions to other AWS services, such as `lambda:InvokeFunction`, `states:StartExecution`, `dynamodb:Query`, `athena:StartQueryExecution`, etc.
-   **`AppRunnerECRAccessRole`**: Assumed by the App Runner **Build Service** (`build.apprunner.amazonaws.com`), *not* the running tasks. It allows the App Runner service itself to pull the container image from ECR during deployment.

---

## **4. Application Logic & Workflow Internals (Source Code Analysis)**

### **4.1. Primary Workflow: `DeforestationDetectionWorkflow` Deep Dive**

This is a state-by-state analysis of the workflow's logic and data transformations.

| State Name | Resource Invoked | Input Payload (from previous state) | Core Logic | Output Payload (to next state) | Error Handling |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `SearchSentinelImages` | `SearchImagesHandler` | `{ "latitude": -6.0, ... }` | Invokes the Java Lambda to construct and execute a detailed STAC API query. | `Payload: { "count": 22, "images": [...] }` | `Retry` on `States.TaskFailed`. |
| `ProcessImagesParallel`| Map State | `$.Payload` | Iterates over the `$.images` array. Each parallel execution receives one element from the array. | An array of the final outputs from each parallel branch. | N/A |
| `CalculateNDVI` | `vegetation-analyzer` | `{ "id": "S2B_...", "assets": { "B04": "...", "B08": "..." } }` | The Python Lambda uses `rasterio` to open the band URLs, calculates NDVI, computes statistics, uploads a 5-D pixel vector JSON to S3, and returns the S3 path. | `{ "success": true, "statistics": {...}, "sagemaker_training_data": "s3://..." }` | `Retry` on `States.TaskFailed`. |
| `CheckExistingModel` | `model-manager` | `{ "imageId": "...", "region": "..." }` | Invokes the model manager in `get-latest-model` mode to check for a pre-existing model artifact in S3 based on both `tile_id` and `region`. | `{ "model_exists": true/false, "model_s3_path": "..." }` | `Retry` on `States.TaskFailed`. |
| `DecideModelStrategy`| Choice Rule | `$.existing_model` | A simple router. Checks the boolean variable `$.existing_model.model_exists`. | The original payload is passed through. | N/A |
| `SelectOptimalK` | `k-selector` | `$.sagemaker_training_data` | The Python Lambda starts multiple parallel SageMaker jobs to find the "elbow point" of the SSE curve. | `{ "optimal_k": 4, "confidence_score": 0.95 }` | **`Catch` block for `States.ALL`**. On any failure, it goes to `StartSageMakerClustering` and passes a default `optimal_k`. This makes the pipeline resilient. |
| `StartSageMakerClustering`| `sagemaker:createTrainingJob.sync`| `$.k_selection_result.optimal_k` | Initiates the main K-means training job, passing the optimal K as a hyperparameter. The `.sync` pattern pauses the workflow. | The full `DescribeTrainingJob` API response from SageMaker. | `Retry` on `SageMaker.AmazonSageMakerException`. `Catch` block for `States.ALL` routes to a `SageMakerFailed` state. |
| `ConsolidateResults` | `results-consolidator` | The array output from the `ProcessImagesParallel` map state. | Aggregates stats, calculates confidence scores, generates a PDF report using `reportlab`, uploads it to S3, and formats the final email content. | `{ "workflow_status": "COMPLETED", "email_content": { "subject": "...", "message": "..." } }` | `Retry` on `States.TaskFailed`. |
| `SendDeforestationAlert`| `sns:publish` | `$.email_content` | Publishes the subject (`$.email_content.subject`) and message (`$.email_content.message`) to the `AlertsTopic`. | N/A | N/A |

### **4.2. Lambda Function Internals & Algorithms**

#### **`vegetation-analyzer` (`handler.py`)**

-   **Purpose**: Core scientific data processing engine.
-   **Algorithm**:
    1.  Receives S3 URLs for Red (B04) and NIR (B08) bands.
    2.  Uses `rasterio` to open these URLs directly in memory.
    3.  Performs NumPy array arithmetic to calculate the NDVI map.
    4.  Generates statistics (mean, min, max, std dev) from the NDVI array.
    5.  Constructs a 5-dimensional data structure for every pixel: `[NDVI, Red, NIR, Latitude, Longitude]`.
    6.  Uploads this comprehensive pixel data as a single JSON file to S3 for SageMaker.
-   **Key Libraries**: `rasterio`, `numpy`, `boto3`.
-   **Invocation Handling**: Detects invocation source (API Gateway vs. Step Functions) by checking for `event['body']`. For Step Functions, it omits the large pixel data array from its return payload to avoid exceeding the 256KB state transition limit, returning only the S3 path.

#### **`k-selector` (`handler.py`)**

-   **Purpose**: Automates hyperparameter tuning for K-means.
-   **Algorithm**: Implements the "Elbow Method".
    1.  Defines a static list of K values to test (e.g., `k_values = [2, 3, 4, 5, 6]`).
    2.  For each `k`, it calls `sagemaker_client.create_training_job()` to start a new training job in parallel.
    3.  It enters a `while` loop, polling `sagemaker_client.describe_training_job()` for each job.
    4.  It extracts the final `sse` (Sum of Squared Errors) metric from the logs of each completed job.
    5.  It programmatically finds the "elbow" of the SSE vs. K curve to determine the optimal K.
-   **Key Libraries**: `boto3`, `numpy`.

#### **`results-consolidator` (`handler.py`)**

-   **Purpose**: The final reporting and analytics engine.
-   **Algorithm**:
    1.  Receives an array of results from the parallel processing stage.
    2.  Calculates aggregate statistics (e.g., average vegetation coverage).
    3.  Performs a sophisticated risk assessment by analyzing model usage and cluster changes.
    4.  Calculates multiple confidence scores to assess the reliability of the analysis.
    5.  Uses the `reportlab` library to programmatically generate a multi-page PDF report with tables and statistics.
    6.  Uploads the generated PDF to S3.
    7.  Formats the final email subject and body for the SNS notification, including a pre-signed link to the PDF.
    8.  Makes an asynchronous, "fire-and-forget" call (`InvocationType='Event'`) to the `model-manager` to trigger performance metric tracking.
-   **Key Libraries**: `reportlab`, `boto3`, `statistics`.

#### **`SearchImagesHandler.java`**

-   **Purpose**: Data acquisition client for the external STAC API.
-   **Logic**:
    1.  Constructs a detailed JSON search payload for the `earth-search.aws.element84.com/v1/search` endpoint.
    2.  The payload specifies the `sentinel-2-l2a` collection and uses the `fields` parameter to request *only* the specific asset URLs and properties (`B04`, `B08`, `id`, etc.) needed downstream. This is a critical network optimization.
    3.  Uses Java's native `HttpClient` to make the POST request.
    4.  Uses the `com.fasterxml.jackson.databind.ObjectMapper` to parse the JSON response and map it to `SentinelImage` Java objects.
-   **Performance Optimizations**: Implements the `org.crac.Resource` interface to leverage AWS Lambda SnapStart, minimizing cold start latency for this Java function.

### **4.3. API Service Layer Logic (NestJS)**

-   **`SentinelDataService`**: Acts as a client and orchestrator. Its `searchImages()` method invokes the `search-images` Lambda and maps the raw STAC feature response into the application's internal `SentinelImage` data model. Its `calculateNDVIWithLambda()` method prepares the payload and invokes the `vegetation-analyzer`, understanding its specific input/output contract.
-   **`DashboardService`**: Manages application state. It performs CRUD operations against the DynamoDB tables and handles user subscriptions by directly interacting with the AWS SNS API.

---

## **5. Data Models & Schemas**

### **5.1. S3 Data Lake Object Schemas**

-   **Raw Pixel Data for Training (`geospatial-data/`)**:
    -   A single JSON file per analysis, containing an array of pixel vectors.
    -   **Pixel Vector Format**: `[<ndvi_float>, <red_int>, <nir_int>, <latitude_double>, <longitude_double>]`. This 5-dimensional vector is the direct input for the `feature_dim: "5"` hyperparameter in the SageMaker K-means job.
-   **ML Model Artifacts (`sagemaker-models/`)**:
    -   **`model.tar.gz`**: The binary model artifact from SageMaker.
    -   **`metadata.json`**: A JSON file created by the `model-manager` to track model provenance.
        ```json
        {
          "tile_id": "S2B_...",
          "region": "aws-eu-central-1",
          "model_version": "20231027-123456",
          "model_s3_path": "s3://...",
          "source_training_job": "k-selection-...",
          "creation_timestamp_utc": "..."
        }
        ```

### **5.2. DynamoDB Table Schemas**

-   **`MonitoredRegionsTable`**:
    -   **Purpose**: Stores user-defined regions to monitor.
    -   **Example Item**:
        ```json
        {
          "regionId": { "S": "a1b2c3d4-e5f6-7890-1234-567890abcdef" },
          "name": { "S": "Amazon Rainforest - Sector A" },
          "latitude": { "N": "-6.0" },
          "longitude": { "N": "-53.0" },
          "radiusKm": { "N": "10" },
          "status": { "S": "ACTIVE" },
          "createdAt": { "S": "2024-01-01T00:00:00Z" }
        }
        ```
-   **`DeforestationAlertsTable`**:
    -   **Purpose**: A log of all triggered deforestation alerts.
    -   **Example Item**:
        ```json
        {
          "alertId": { "S": "f0e9d8c7-b6a5-4321-fedc-ba9876543210" },
          "regionId": { "S": "a1b2c3d4-e5f6-7890-1234-567890abcdef" },
          "regionName": { "S": "Amazon Rainforest - Sector A" },
          "level": { "S": "HIGH" },
          "deforestationPercentage": { "N": "15.2" },
          "timestamp": { "S": "2024-01-15T10:30:00Z" },
          "acknowledged": { "BOOL": false }
        }
        ```