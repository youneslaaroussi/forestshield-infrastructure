import json
import logging
import time
from typing import Dict, Any
from ndvi_processor import VegetationProcessor
from s3_utils import S3Handler

# Test GDAL import at startup (like our GDAL test function)
try:
    from osgeo import gdal, ogr, osr
    gdal_version = gdal.VersionInfo()
    print(f"✅ GDAL loaded successfully! Version: {gdal_version}")
except ImportError as e:
    print(f"❌ GDAL import failed: {e}")
    raise

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for vegetation analysis (NDVI calculation)
    
    Uses GeoLambda layer with rasterio - NO JAVA, NO BULLSHIT!
    Processes Sentinel-2 satellite imagery to calculate NDVI and vegetation statistics.
    
    Args:
        event: Lambda event containing image URLs and parameters
        context: Lambda context object
        
    Returns:
        API Gateway response with NDVI results or error
    """
    
    start_time = time.time()
    
    try:
        logger.info(f"🌱 Starting vegetation analysis - Request ID: {context.aws_request_id}")
        
        # Parse input from API Gateway event
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        else:
            body = event.get('body', {})
            
        # Validate required parameters
        required_fields = ['imageId', 'redBandUrl', 'nirBandUrl', 'outputBucket']
        missing_fields = [field for field in required_fields if field not in body]
        
        if missing_fields:
            raise ValueError(f"Missing required fields: {', '.join(missing_fields)}")
            
        # Extract parameters
        image_id = body['imageId']
        red_band_url = body['redBandUrl']
        nir_band_url = body['nirBandUrl']
        output_bucket = body['outputBucket']
        region = body.get('region', {'latitude': 0, 'longitude': 0})
        
        logger.info(f"📸 Processing image: {image_id}")
        logger.info(f"🔴 Red band: {red_band_url}")
        logger.info(f"🟢 NIR band: {nir_band_url}")
        
        # Initialize processors
        vegetation_processor = VegetationProcessor()
        s3_handler = S3Handler(output_bucket)
        
        # Process vegetation data
        logger.info("🧮 Calculating NDVI...")
        ndvi_result = vegetation_processor.calculate_ndvi_from_urls(
            red_url=red_band_url,
            nir_url=nir_band_url,
            image_id=image_id
        )
        
        # Upload results to S3
        logger.info("☁️ Uploading results to S3...")
        s3_output_path = s3_handler.upload_ndvi_result(
            ndvi_data=ndvi_result['ndvi_array'],
            profile=ndvi_result['profile'],
            image_id=image_id
        )
        
        # Calculate processing time
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Prepare response
        response_data = {
            'success': True,
            'imageId': image_id,
            'statistics': ndvi_result['statistics'],
            'ndvi_output': s3_output_path,
            'processing_time_ms': processing_time_ms,
            'region': region
        }
        
        logger.info(f"✅ Vegetation analysis completed in {processing_time_ms}ms")
        logger.info(f"📊 NDVI Stats: mean={ndvi_result['statistics']['mean_ndvi']:.3f}, "
                   f"vegetation={ndvi_result['statistics']['vegetation_coverage']:.1f}%")
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps(response_data)
        }
        
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        error_message = str(e)
        
        logger.error(f"❌ Vegetation analysis failed: {error_message}")
        logger.error(f"⏱️ Failed after {processing_time_ms}ms")
        
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'success': False,
                'error': error_message,
                'processing_time_ms': processing_time_ms
            })
        } 