package com.forestshield;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import software.amazon.awssdk.services.sagemaker.SageMakerClient;
import software.amazon.awssdk.services.sagemaker.model.*;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.sns.SnsClient;
import software.amazon.awssdk.services.sns.model.PublishRequest;
import org.crac.Resource;
import org.crac.Core;
import java.time.Instant;
import java.util.*;

/**
 * AWS Lambda function for processing NDVI data with SageMaker K-means clustering
 * Classifies deforestation patterns using unsupervised machine learning
 * Optimized with SnapStart for instant execution
 */
public class SageMakerProcessorHandler implements RequestHandler<Object, Object>, Resource {
    
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final SageMakerClient sageMakerClient = SageMakerClient.builder().build();
    private static final S3Client s3Client = S3Client.builder().build();
    private static final SnsClient snsClient = SnsClient.builder().build();
    
    // SageMaker configuration
    private static final String SAGEMAKER_ROLE_ARN = System.getenv("SAGEMAKER_ROLE");
    private static final String DATA_BUCKET = System.getenv("DATA_BUCKET");
    private static final String SNS_TOPIC_ARN = System.getenv("SNS_TOPIC_ARN");
    
    // SnapStart initialization
    static {
        try {
            Core.getGlobalContext().register(new SageMakerProcessorHandler());
        } catch (Exception e) {
            // Handle initialization for SnapStart
        }
    }
    
    @Override
    public void beforeCheckpoint(org.crac.Context context) throws Exception {
        System.out.println("Preparing SageMaker processor for SnapStart checkpoint...");
    }
    
    @Override
    public void afterRestore(org.crac.Context context) throws Exception {
        System.out.println("SageMaker processor restored from SnapStart checkpoint");
    }
    
    @Override
    public Object handleRequest(Object event, Context context) {
        try {
            System.out.println("Processing SageMaker K-means clustering request");
            System.out.println("Input event type: " + event.getClass().getSimpleName());
            
            JsonNode requestBody;
            boolean isApiGateway = false;
            
            if (event instanceof APIGatewayProxyRequestEvent) {
                // Invoked via API Gateway
                APIGatewayProxyRequestEvent apiEvent = (APIGatewayProxyRequestEvent) event;
                isApiGateway = true;
                if (apiEvent.getBody() != null && !apiEvent.getBody().isEmpty()) {
                    requestBody = objectMapper.readTree(apiEvent.getBody());
                } else {
                    requestBody = objectMapper.convertValue(apiEvent, JsonNode.class);
                }
            } else {
                // Invoked directly (e.g., from Step Functions) - event is already the payload
                requestBody = objectMapper.convertValue(event, JsonNode.class);
            }
            
            System.out.println("Request body: " + requestBody.toString());
            
            String jobName = requestBody.get("jobName").asText();
            String inputDataPath = requestBody.get("inputDataPath").asText();
            int kClusters = requestBody.has("kClusters") ? requestBody.get("kClusters").asInt() : 3;
            String imageId = requestBody.has("imageId") ? requestBody.get("imageId").asText() : "unknown";
            
            System.out.println("Job name: " + jobName);
            System.out.println("Input data: " + inputDataPath);
            System.out.println("K clusters: " + kClusters);
            
            // Start SageMaker training job
            TrainingJobResult result = startKMeansTrainingJob(jobName, inputDataPath, kClusters, imageId);
            
            // Create response
            Map<String, Object> responseBody = new HashMap<>();
            responseBody.put("success", true);
            responseBody.put("job_name", result.jobName);
            responseBody.put("job_arn", result.jobArn);
            responseBody.put("job_status", result.status);
            responseBody.put("training_image", result.trainingImage);
            responseBody.put("input_data_config", result.inputDataConfig);
            responseBody.put("output_data_config", result.outputDataConfig);
            responseBody.put("algorithm_specification", result.algorithmSpec);
            responseBody.put("hyperparameters", result.hyperparameters);
            responseBody.put("lambda_function", "forestshield-sagemaker-processor-java");
            
            if (isApiGateway) {
                return createResponse(200, responseBody);
            } else {
                // For Step Functions, return the response body directly
                return responseBody;
            }
            
        } catch (Exception e) {
            System.err.println("Error starting SageMaker job: " + e.getMessage());
            e.printStackTrace();
            
            Map<String, Object> errorBody = new HashMap<>();
            errorBody.put("success", false);
            errorBody.put("error", e.getMessage());
            
            if (event instanceof APIGatewayProxyRequestEvent) {
                return createResponse(500, errorBody);
            } else {
                // For Step Functions, return the error body directly
                return errorBody;
            }
        }
    }
    
    private TrainingJobResult startKMeansTrainingJob(String jobName, String inputDataPath, int kClusters, String imageId) throws Exception {
        String timestamp = String.valueOf(Instant.now().getEpochSecond());
        
        // Sanitize job name to comply with SageMaker requirements: [a-zA-Z0-9](-*[a-zA-Z0-9]){0,62}
        String sanitizedJobName = jobName.replaceAll("[^a-zA-Z0-9-]", "-").replaceAll("-+", "-");
        if (sanitizedJobName.startsWith("-")) {
            sanitizedJobName = sanitizedJobName.substring(1);
        }
        if (sanitizedJobName.endsWith("-")) {
            sanitizedJobName = sanitizedJobName.substring(0, sanitizedJobName.length() - 1);
        }
        
        String fullJobName = String.format("%s-%s", sanitizedJobName, timestamp);
        
        // Ensure job name doesn't exceed 63 characters
        if (fullJobName.length() > 63) {
            fullJobName = fullJobName.substring(0, 63);
            if (fullJobName.endsWith("-")) {
                fullJobName = fullJobName.substring(0, 62);
            }
        }
        
        System.out.println("Original job name: " + jobName);
        System.out.println("Sanitized job name: " + fullJobName);
        
        // Check if SageMaker role ARN is configured
        if (SAGEMAKER_ROLE_ARN == null || SAGEMAKER_ROLE_ARN.isEmpty()) {
            throw new RuntimeException("SAGEMAKER_ROLE environment variable is not set. Please configure the SageMaker execution role.");
        }
        
        System.out.println("Using SageMaker role: " + SAGEMAKER_ROLE_ARN);
        System.out.println("Output bucket: " + DATA_BUCKET);
        
        // Training image for K-means (Amazon's built-in algorithm)
        // Use the correct region - us-west-2
        String trainingImage = "174872318107.dkr.ecr.us-west-2.amazonaws.com/kmeans:1";
        
        // Input data configuration
        Channel inputChannel = Channel.builder()
            .channelName("training")
            .contentType("text/csv")
            .compressionType(CompressionType.NONE)
            .recordWrapperType(RecordWrapper.NONE)
            .dataSource(DataSource.builder()
                .s3DataSource(S3DataSource.builder()
                    .s3DataType(S3DataType.S3_PREFIX)
                    .s3Uri(inputDataPath)
                    .s3DataDistributionType(S3DataDistribution.FULLY_REPLICATED)
                    .build())
                .build())
            .build();
        
        // Output data configuration
        String outputPath = String.format("s3://%s/sagemaker-output/kmeans/%s/", DATA_BUCKET, fullJobName);
        OutputDataConfig outputDataConfig = OutputDataConfig.builder()
            .s3OutputPath(outputPath)
            .build();
        
        // Resource configuration
        ResourceConfig resourceConfig = ResourceConfig.builder()
            .instanceType(TrainingInstanceType.ML_M5_LARGE)
            .instanceCount(1)
            .volumeSizeInGB(30)
            .build();
        
        // Stopping condition
        StoppingCondition stoppingCondition = StoppingCondition.builder()
            .maxRuntimeInSeconds(3600) // 1 hour max
            .build();
        
        // Algorithm specification
        AlgorithmSpecification algorithmSpec = AlgorithmSpecification.builder()
            .trainingImage(trainingImage)
            .trainingInputMode(TrainingInputMode.FILE)
            .build();
        
        // Hyperparameters for K-means
        Map<String, String> hyperparameters = new HashMap<>();
        hyperparameters.put("k", String.valueOf(kClusters));
        hyperparameters.put("feature_dim", "5"); // 5D features: [NDVI, Red, NIR, Lat, Lng]
        hyperparameters.put("mini_batch_size", "1000");
        hyperparameters.put("epochs", "10");
        hyperparameters.put("init_method", "kmeans++");
        hyperparameters.put("local_init_method", "kmeans++");
        hyperparameters.put("half_life_time_size", "0");
        hyperparameters.put("epochs_between_reporting", "1");
        
        // Create training job request
        CreateTrainingJobRequest request = CreateTrainingJobRequest.builder()
            .trainingJobName(fullJobName)
            .algorithmSpecification(algorithmSpec)
            .roleArn(SAGEMAKER_ROLE_ARN)
            .inputDataConfig(inputChannel)
            .outputDataConfig(outputDataConfig)
            .resourceConfig(resourceConfig)
            .stoppingCondition(stoppingCondition)
            .hyperParameters(hyperparameters)
            .tags(
                Tag.builder().key("Project").value("ForestShield").build(),
                Tag.builder().key("Component").value("DeforestationDetection").build(),
                Tag.builder().key("ImageId").value(imageId).build()
            )
            .build();
        
        // Start the training job
        CreateTrainingJobResponse response = sageMakerClient.createTrainingJob(request);
        
        System.out.println("Started SageMaker training job: " + fullJobName);
        System.out.println("Job ARN: " + response.trainingJobArn());
        
        // Send notification
        if (SNS_TOPIC_ARN != null && !SNS_TOPIC_ARN.isEmpty()) {
            sendNotification(fullJobName, "STARTED", imageId);
        }
        
        // Return job details
        TrainingJobResult result = new TrainingJobResult();
        result.jobName = fullJobName;
        result.jobArn = response.trainingJobArn();
        result.status = "InProgress";
        result.trainingImage = trainingImage;
        result.inputDataConfig = Map.of(
            "channel_name", "training",
            "content_type", "text/csv",
            "s3_uri", inputDataPath
        );
        result.outputDataConfig = Map.of(
            "s3_output_path", outputPath
        );
        result.algorithmSpec = Map.of(
            "training_image", trainingImage,
            "training_input_mode", "File"
        );
        result.hyperparameters = hyperparameters;
        
        return result;
    }
    
    private void sendNotification(String jobName, String status, String imageId) {
        try {
            String message = String.format(
                "ForestShield SageMaker Job Update\n\n" +
                "Job Name: %s\n" +
                "Status: %s\n" +
                "Image ID: %s\n" +
                "Algorithm: K-means clustering\n" +
                "Purpose: Deforestation pattern analysis\n" +
                "Timestamp: %s",
                jobName, status, imageId, Instant.now().toString()
            );
            
            PublishRequest publishRequest = PublishRequest.builder()
                .topicArn(SNS_TOPIC_ARN)
                .subject("ForestShield - SageMaker Job " + status)
                .message(message)
                .build();
                
            snsClient.publish(publishRequest);
            System.out.println("Sent SNS notification for job: " + jobName);
            
        } catch (Exception e) {
            System.err.println("Failed to send SNS notification: " + e.getMessage());
        }
    }
    
    private APIGatewayProxyResponseEvent createResponse(int statusCode, Object body) {
        try {
            APIGatewayProxyResponseEvent response = new APIGatewayProxyResponseEvent();
            response.setStatusCode(statusCode);
            response.setBody(objectMapper.writeValueAsString(body));
            
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Type", "application/json");
            headers.put("Access-Control-Allow-Origin", "*");
            response.setHeaders(headers);
            
            return response;
        } catch (Exception e) {
            throw new RuntimeException("Failed to create response", e);
        }
    }
    
    // Result class for training job details
    static class TrainingJobResult {
        public String jobName;
        public String jobArn;
        public String status;
        public String trainingImage;
        public Map<String, Object> inputDataConfig;
        public Map<String, Object> outputDataConfig;
        public Map<String, Object> algorithmSpec;
        public Map<String, String> hyperparameters;
    }
} 