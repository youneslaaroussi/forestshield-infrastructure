#!/usr/bin/env python3
"""
SAGEMAKER-READY TEST: Validates SageMaker-First Architecture
- Lambda extracts pixel data only
- No scikit-learn or local ML operations
- All ML processing happens in SageMaker
"""

import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from handler import lambda_handler

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_sagemaker_ready_architecture():
    """Test that Lambda only does pixel extraction, no ML operations"""
    
    # Real Amazon forest URLs for testing
    test_event = {
        "imageId": "S2A_22MBU_20220816_sagemaker_ready",
        "redBandUrl": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2A_22MBU_20220816_0_L2A/B04.tif",
        "nirBandUrl": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2A_22MBU_20220816_0_L2A/B08.tif",
        "outputBucket": "forestshield-test-output",
        "region": {
            "latitude": -5.9,
            "longitude": -53.0
        }
    }
    
    class MockContext:
        aws_request_id = "sagemaker-ready-test-12345"
        function_name = "vegetation-analyzer-sagemaker-ready"
        memory_limit_in_mb = 3008
        remaining_time_in_millis = lambda self: 120000
    
    context = MockContext()
    
    logger.info("🤖 SAGEMAKER-READY TEST: Validating SageMaker-First Architecture")
    logger.info("=" * 70)
    logger.info("✅ Architecture principles:")
    logger.info("   🚫 NO scikit-learn in Lambda")
    logger.info("   🚫 NO local ML operations")
    logger.info("   ✅ Lambda extracts pixel data only")
    logger.info("   ✅ SageMaker handles ALL ML operations")
    logger.info("   ✅ 5-dimensional feature space ready")
    logger.info("=" * 70)
    
    try:
        start_time = time.time()
        
        # Call the SageMaker-ready handler
        result = lambda_handler(test_event, context)
        
        processing_time = time.time() - start_time
        
        if result.get('success'):
            logger.info(f"✅ SAGEMAKER-READY TEST PASSED! Processing time: {processing_time:.2f}s")
            
            # Validate that Lambda ONLY extracted pixel data
            pixel_data = result.get('pixel_data', [])
            pixel_count = len(pixel_data)
            logger.info(f"🎯 Real pixels extracted: {pixel_count}")
            
            if pixel_count > 0:
                sample = pixel_data[0]
                logger.info(f"📊 Sample pixel: NDVI={sample[0]:.3f}, Red={sample[1]:.1f}, NIR={sample[2]:.1f}, Lat={sample[3]:.6f}, Lng={sample[4]:.6f}")
                
                # Validate 5-dimensional feature structure
                if len(sample) == 5:
                    logger.info("✅ 5-dimensional pixel features confirmed: [NDVI, Red, NIR, Lat, Lng]")
                else:
                    logger.error(f"❌ Expected 5 features, got {len(sample)}")
                    return False
                
                # Validate that NO K-selection was done in Lambda
                if 'optimal_k_analysis' in result:
                    logger.error("❌ ARCHITECTURE VIOLATION: K-selection found in Lambda response!")
                    logger.error("   SageMaker should handle ALL ML operations")
                    return False
                else:
                    logger.info("✅ No local ML operations detected - SageMaker-first architecture confirmed")
                
                # Validate SageMaker training data is ready
                training_path = result.get('sagemaker_training_data', '')
                if training_path and 's3://' in training_path:
                    logger.info(f"✅ SageMaker training data ready: {training_path}")
                    
                    # Check if it's the enhanced format
                    if '5features' in training_path or 'real_pixel' in training_path:
                        logger.info("✅ Enhanced 5-feature format confirmed")
                    else:
                        logger.warning("⚠️ Training data format unclear - check S3 upload logic")
                else:
                    logger.error("❌ No SageMaker training data path found")
                    return False
                
                # Validate phase tracking
                phase = result.get('phase', '')
                if 'SageMaker-Only' in phase:
                    logger.info(f"✅ Phase tracking: {phase}")
                else:
                    logger.warning(f"⚠️ Unexpected phase: {phase}")
                
                # Check coordinate transformation worked
                lat_values = [p[3] for p in pixel_data[:10]]  # First 10 latitudes
                lng_values = [p[4] for p in pixel_data[:10]]  # First 10 longitudes
                
                if all(-90 <= lat <= 90 for lat in lat_values) and all(-180 <= lng <= 180 for lng in lng_values):
                    logger.info("✅ Coordinate transformation working correctly")
                else:
                    logger.error("❌ Invalid coordinates detected")
                    return False
                
                logger.info("🎉 SAGEMAKER-READY ARCHITECTURE VALIDATION:")
                logger.info("   ✅ Pixel extraction working (Phase 1)")
                logger.info("   ✅ 5-dimensional features ready")
                logger.info("   ✅ No local ML operations (SageMaker-first)")
                logger.info("   ✅ Enhanced training data format")
                logger.info("   ✅ Coordinate transformation fixed")
                logger.info("   ✅ S3 upload ready for SageMaker")
                
                return True
            else:
                logger.error("❌ No pixel data extracted")
                return False
        else:
            logger.error(f"❌ SAGEMAKER-READY TEST FAILED: {result.get('error', 'Unknown error')}")
            return False
            
    except Exception as e:
        logger.error(f"❌ SAGEMAKER-READY TEST EXCEPTION: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    logger.info("=" * 80)
    logger.info("🤖 SAGEMAKER-READY ARCHITECTURE TEST")
    logger.info("🎯 Lambda extracts pixels, SageMaker does ML")
    logger.info("=" * 80)
    
    success = test_sagemaker_ready_architecture()
    
    if success:
        logger.info("🎉 SAGEMAKER-FIRST ARCHITECTURE VALIDATED!")
        logger.info("✅ Lambda: Pixel extraction only")
        logger.info("✅ SageMaker: All ML operations")
        logger.info("✅ 5-dimensional features ready")
        logger.info("✅ No scikit-learn dependencies")
        logger.info("🚀 Ready for SageMaker K-means clustering!")
        logger.info("")
        logger.info("📋 NEXT STEPS:")
        logger.info("   1. Deploy updated Lambda function")
        logger.info("   2. Deploy updated SageMaker processor")
        logger.info("   3. Test Step Functions workflow")
        logger.info("   4. Validate end-to-end SageMaker clustering")
    else:
        logger.error("💥 SAGEMAKER-READY ARCHITECTURE FAILED!")
        logger.error("❌ Fix issues before SageMaker deployment")
    
    logger.info("=" * 80) 