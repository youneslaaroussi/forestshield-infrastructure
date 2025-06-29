package com.forestshield;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyRequestEvent;
import com.amazonaws.services.lambda.runtime.events.APIGatewayProxyResponseEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.JsonNode;
import software.amazon.awssdk.services.s3.S3Client;
import org.crac.Resource;
import org.crac.Core;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.URI;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * AWS Lambda function for searching Sentinel-2 satellite images
 * Queries AWS Open Data STAC API for available images
 * Optimized with SnapStart for zero cold starts
 */
public class SearchImagesHandler implements RequestHandler<Object, Object>, Resource {
    
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final HttpClient httpClient = HttpClient.newHttpClient();
    private static final S3Client s3Client = S3Client.builder().build();
    
    // STAC API endpoint for Sentinel-2 on AWS
    private static final String STAC_ENDPOINT = "https://earth-search.aws.element84.com/v1";
    
    // SnapStart initialization
    static {
        try {
            Core.getGlobalContext().register(new SearchImagesHandler());
        } catch (Exception e) {
            // Handle initialization for SnapStart
        }
    }
    
    @Override
    public void beforeCheckpoint(org.crac.Context context) throws Exception {
        // Pre-warm HTTP connections for SnapStart
        System.out.println("Preparing SearchImages for SnapStart checkpoint...");
    }
    
    @Override
    public void afterRestore(org.crac.Context context) throws Exception {
        System.out.println("SearchImages restored from SnapStart checkpoint");
    }
    
    @Override
    public Object handleRequest(Object event, Context context) {
        try {
            System.out.println("Processing Sentinel-2 image search request");
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

            // Extract from searchParams if nested
            if (requestBody.has("searchParams")) {
                requestBody = requestBody.get("searchParams");
                System.out.println("Using nested searchParams: " + requestBody.toString());
            }

            // Add null checks for all required parameters
            if (!requestBody.has("latitude") || requestBody.get("latitude") == null) {
                throw new IllegalArgumentException("Missing required parameter: latitude");
            }
            if (!requestBody.has("longitude") || requestBody.get("longitude") == null) {
                throw new IllegalArgumentException("Missing required parameter: longitude");
            }
            if (!requestBody.has("startDate") || requestBody.get("startDate") == null) {
                throw new IllegalArgumentException("Missing required parameter: startDate");
            }
            if (!requestBody.has("endDate") || requestBody.get("endDate") == null) {
                throw new IllegalArgumentException("Missing required parameter: endDate");
            }

            double latitude = requestBody.get("latitude").asDouble();
            double longitude = requestBody.get("longitude").asDouble();
            String startDate = requestBody.get("startDate").asText();
            String endDate = requestBody.get("endDate").asText();
            double cloudCover = requestBody.has("cloudCover") && requestBody.get("cloudCover") != null 
                ? requestBody.get("cloudCover").asDouble() : 20.0;
            int limit = requestBody.has("limit") && requestBody.get("limit") != null 
                ? requestBody.get("limit").asInt() : 50;
            
            System.out.println(String.format("Searching images for coordinates: %.2f, %.2f", latitude, longitude));
            System.out.println(String.format("Date range: %s to %s", startDate, endDate));
            System.out.println(String.format("Max cloud cover: %.1f%%", cloudCover));
            System.out.println(String.format("Image limit: %d", limit));
            
            // Search for Sentinel-2 images
            List<SentinelImage> images = searchSentinelImages(latitude, longitude, startDate, endDate, cloudCover, limit);
            
            // Create response
            Map<String, Object> responseBody = new HashMap<>();
            responseBody.put("success", true);
            responseBody.put("count", images.size());
            responseBody.put("images", images);
            responseBody.put("search_parameters", Map.of(
                "latitude", latitude,
                "longitude", longitude,
                "start_date", startDate,
                "end_date", endDate,
                "cloud_cover_max", cloudCover
            ));
            responseBody.put("lambda_function", "forestshield-search-images-java");
            
            if (isApiGateway) {
                return createResponse(200, responseBody);
            } else {
                // For Step Functions, return the response body directly
                return responseBody;
            }
            
        } catch (Exception e) {
            System.err.println("Error searching images: " + e.getMessage());
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
    
    private List<SentinelImage> searchSentinelImages(double latitude, double longitude, String startDate, String endDate, double cloudCover, int limit) throws Exception {
        // Create bounding box around the point (±0.1 degrees = ~11km)
        double[] bbox = {
            longitude - 0.1,
            latitude - 0.1,
            longitude + 0.1,
            latitude + 0.1
        };
        
        // Build STAC search payload
        Map<String, Object> searchPayload = new HashMap<>();
        searchPayload.put("limit", limit);
        searchPayload.put("datetime", startDate + "T00:00:00Z/" + endDate + "T23:59:59Z");
        searchPayload.put("bbox", bbox);
        searchPayload.put("collections", List.of("sentinel-2-l2a"));
        
        Map<String, Object> query = new HashMap<>();
        query.put("eo:cloud_cover", Map.of("lte", cloudCover));
        searchPayload.put("query", query);
        
        // Request specific fields including the spectral bands we need
        Map<String, Object> fields = new HashMap<>();
        fields.put("include", List.of(
            "id", "datetime", "geometry", "properties", "bbox",
            "assets.B04", "assets.B08", "assets.B02", "assets.B03", "assets.visual"
        ));
        fields.put("exclude", List.of("links"));
        searchPayload.put("fields", fields);
        
        // Make HTTP request to STAC API
        String requestBody = objectMapper.writeValueAsString(searchPayload);
        
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(STAC_ENDPOINT + "/search"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(requestBody))
            .build();
        
        HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        
        if (response.statusCode() != 200) {
            throw new RuntimeException("STAC API request failed with status: " + response.statusCode());
        }
        
        // Parse response
        JsonNode responseJson = objectMapper.readTree(response.body());
        JsonNode features = responseJson.get("features");
        
        List<SentinelImage> images = new ArrayList<>();
        
        if (features != null && features.isArray()) {
            for (JsonNode feature : features) {
                JsonNode properties = feature.get("properties");
                if (properties == null) {
                    System.err.println("Feature " + feature.get("id") + " is missing 'properties' field. Skipping.");
                    continue; // Skip this feature
                }

                SentinelImage image = new SentinelImage();
                image.id = feature.get("id").asText();
                image.date = properties.get("datetime").asText();
                image.cloudCover = properties.has("eo:cloud_cover")
                    ? properties.get("eo:cloud_cover").asDouble()
                    : 0.0;
                image.geometry = objectMapper.convertValue(feature.get("geometry"), Map.class);
                
                if (feature.has("bbox")) {
                    image.bbox = objectMapper.convertValue(feature.get("bbox"), double[].class);
                }
                
                // Extract asset URLs
                JsonNode assets = feature.get("assets");
                if (assets != null) {
                    image.assets = new HashMap<>();
                    
                    // Debug: log available assets
                    System.out.println("Available assets for image " + image.id + ":");
                    assets.fieldNames().forEachRemaining(fieldName -> {
                        System.out.println("  - " + fieldName);
                    });
                    
                    // Extract all relevant assets
                    if (assets.has("B04")) {
                        String b04Url = assets.get("B04").get("href").asText();
                        image.assets.put("B04", b04Url);
                        System.out.println("B04 URL: " + b04Url);
                    }
                    if (assets.has("B08")) {
                        String b08Url = assets.get("B08").get("href").asText();
                        image.assets.put("B08", b08Url);
                        System.out.println("B08 URL: " + b08Url);
                    }
                    if (assets.has("B02")) image.assets.put("B02", assets.get("B02").get("href").asText());
                    if (assets.has("B03")) image.assets.put("B03", assets.get("B03").get("href").asText());
                    if (assets.has("visual")) {
                        String visualUrl = assets.get("visual").get("href").asText();
                        image.assets.put("visual", visualUrl);
                        
                        // Fallback: construct B04 and B08 URLs from visual URL if not available
                        if (!assets.has("B04") && visualUrl.contains("TCI.tif")) {
                            String b04Url = visualUrl.replace("TCI.tif", "B04.tif");
                            image.assets.put("B04", b04Url);
                            System.out.println("Constructed B04 URL: " + b04Url);
                        }
                        if (!assets.has("B08") && visualUrl.contains("TCI.tif")) {
                            String b08Url = visualUrl.replace("TCI.tif", "B08.tif");
                            image.assets.put("B08", b08Url);
                            System.out.println("Constructed B08 URL: " + b08Url);
                        }
                    }
                    
                    // Debug: log final assets
                    System.out.println("Final assets for image " + image.id + ": " + image.assets);
                }
                
                images.add(image);
            }
        }
        
        System.out.println("Found " + images.size() + " Sentinel-2 images");
        return images;
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
    
    // Data class for Sentinel-2 image metadata
    static class SentinelImage {
        public String id;
        public String date;
        public double cloudCover;
        public Map<String, Object> geometry;
        public Map<String, String> assets = new HashMap<>();
        public double[] bbox;
    }
} 