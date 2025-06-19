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
public class SageMakerProcessorHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent>, Resource {
    
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final SageMakerClient sageMakerClient = SageMakerClient.builder().build();
    private static final S3Client s3Client = S3Client.builder().build();
    private static final SnsClient snsClient = SnsClient.builder().build();
    
    // SageMaker configuration
    private static final String SAGEMAKER_ROLE_ARN = System.getenv("SAGEMAKER_ROLE_ARN");
    private static final String S3_OUTPUT_BUCKET = System.getenv("S3_OUTPUT_BUCKET");
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
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent event, Context context) {
        try {
            System.out.println("Processing SageMaker K-means clustering request");
            
            // Parse request body
            JsonNode requestBody = objectMapper.readTree(event.getBody());
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
            
            return createResponse(200, responseBody);
            
        } catch (Exception e) {
            System.err.println("Error starting SageMaker job: " + e.getMessage());
            e.printStackTrace();
            
            Map<String, Object> errorBody = new HashMap<>();
            errorBody.put("success", false);
            errorBody.put("error", e.getMessage());
            
            return createResponse(500, errorBody);
        }
    }
    
    private TrainingJobResult startKMeansTrainingJob(String jobName, String inputDataPath, int kClusters, String imageId) throws Exception {
        String timestamp = String.valueOf(Instant.now().getEpochSecond());
        String fullJobName = String.format("%s-%s", jobName, timestamp);
        
        // Training image for K-means (Amazon's built-in algorithm)
        String trainingImage = "382416733822.dkr.ecr.us-east-1.amazonaws.com/kmeans:1";
        
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
        String outputPath = String.format("s3://%s/sagemaker-output/kmeans/%s/", S3_OUTPUT_BUCKET, fullJobName);
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
        hyperparameters.put("feature_dim", "1"); // NDVI is single dimension
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