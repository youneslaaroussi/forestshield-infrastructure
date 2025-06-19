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
public class SearchImagesHandler implements RequestHandler<APIGatewayProxyRequestEvent, APIGatewayProxyResponseEvent>, Resource {
    
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
    public APIGatewayProxyResponseEvent handleRequest(APIGatewayProxyRequestEvent event, Context context) {
        try {
            System.out.println("Processing Sentinel-2 image search request");
            
            // Parse request parameters
            JsonNode requestBody = objectMapper.readTree(event.getBody());
            double latitude = requestBody.get("latitude").asDouble();
            double longitude = requestBody.get("longitude").asDouble();
            String startDate = requestBody.get("startDate").asText();
            String endDate = requestBody.get("endDate").asText();
            double cloudCover = requestBody.has("cloudCover") ? requestBody.get("cloudCover").asDouble() : 20.0;
            
            System.out.println(String.format("Searching images for coordinates: %.2f, %.2f", latitude, longitude));
            System.out.println(String.format("Date range: %s to %s", startDate, endDate));
            System.out.println(String.format("Max cloud cover: %.1f%%", cloudCover));
            
            // Search for Sentinel-2 images
            List<SentinelImage> images = searchSentinelImages(latitude, longitude, startDate, endDate, cloudCover);
            
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
            
            return createResponse(200, responseBody);
            
        } catch (Exception e) {
            System.err.println("Error searching images: " + e.getMessage());
            e.printStackTrace();
            
            Map<String, Object> errorBody = new HashMap<>();
            errorBody.put("success", false);
            errorBody.put("error", e.getMessage());
            
            return createResponse(500, errorBody);
        }
    }
    
    private List<SentinelImage> searchSentinelImages(double latitude, double longitude, String startDate, String endDate, double cloudCover) throws Exception {
        // Create bounding box around the point (±0.1 degrees = ~11km)
        double[] bbox = {
            longitude - 0.1,
            latitude - 0.1,
            longitude + 0.1,
            latitude + 0.1
        };
        
        // Build STAC search payload
        Map<String, Object> searchPayload = new HashMap<>();
        searchPayload.put("limit", 50);
        searchPayload.put("datetime", startDate + "T00:00:00Z/" + endDate + "T23:59:59Z");
        searchPayload.put("bbox", bbox);
        searchPayload.put("collections", List.of("sentinel-2-l2a"));
        
        Map<String, Object> query = new HashMap<>();
        query.put("eo:cloud_cover", Map.of("lte", cloudCover));
        searchPayload.put("query", query);
        
        Map<String, Object> fields = new HashMap<>();
        fields.put("include", List.of(
            "id", "datetime", "geometry", "properties", 
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
                SentinelImage image = new SentinelImage();
                image.id = feature.get("id").asText();
                image.date = feature.get("properties").get("datetime").asText();
                image.cloudCover = feature.get("properties").has("eo:cloud_cover") 
                    ? feature.get("properties").get("eo:cloud_cover").asDouble() 
                    : 0.0;
                image.geometry = objectMapper.convertValue(feature.get("geometry"), Map.class);
                
                if (feature.has("bbox")) {
                    image.bbox = objectMapper.convertValue(feature.get("bbox"), double[].class);
                }
                
                // Extract asset URLs
                JsonNode assets = feature.get("assets");
                if (assets != null) {
                    image.assets = new HashMap<>();
                    if (assets.has("B04")) image.assets.put("B04", assets.get("B04").get("href").asText());
                    if (assets.has("B08")) image.assets.put("B08", assets.get("B08").get("href").asText());
                    if (assets.has("B02")) image.assets.put("B02", assets.get("B02").get("href").asText());
                    if (assets.has("B03")) image.assets.put("B03", assets.get("B03").get("href").asText());
                    if (assets.has("visual")) image.assets.put("visual", assets.get("visual").get("href").asText());
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