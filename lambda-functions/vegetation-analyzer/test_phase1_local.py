#!/usr/bin/env python3
"""
Test pixel extraction without S3 dependencies
"""

import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Test just the NDVI processor directly
from ndvi_processor import VegetationProcessor

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def test_pixel_extraction():
    """Test Real pixel data extraction from Amazon rainforest imagery"""
    
    logger.info("Testing pixel extraction only")
    logger.info("Target: Amazon rainforest satellite imagery")
    
    # Amazon rainforest coordinates (Brazil) - Sentinel-2 Level 2A data
    # Try different tiles to find one with valid data
    test_tiles = [
        # Tile 22MBU - Original (might be cloudy/masked)
        {
            "name": "22MBU (Original)",
            "red_url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2A_22MBU_20220816_0_L2A/B04.tif",
            "nir_url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2A_22MBU_20220816_0_L2A/B08.tif"
        },
        # Tile 21LYH - Different Amazon region
        {
            "name": "21LYH (Alternative Amazon)",
            "red_url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/21/L/YH/2022/8/S2A_21LYH_20220815_0_L2A/B04.tif",
            "nir_url": "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/21/L/YH/2022/8/S2A_21LYH_20220815_0_L2A/B08.tif"
        }
    ]
    
    for tile in test_tiles:
        logger.info(f"Testing tile: {tile['name']}")
        logger.info(f"Red band: {tile['red_url']}")
        logger.info(f"NIR band: {tile['nir_url']}")
        
        # Initialize processor with smaller limits for testing
        logger.info("Initializing VegetationProcessor with REAL PIXEL DATA extraction")
        processor = VegetationProcessor(
            chunk_size=512,           # Smaller chunks for faster processing
            max_pixels_per_image=1000  # Much smaller limit for testing
        )
        
        try:
            logger.info("Starting pixel data extraction...")
            result = processor.calculate_ndvi_from_urls(
                tile['red_url'], 
                tile['nir_url'], 
                "test_pixel_extraction"
            )
            
            # Check if we got any pixels
            pixel_count = len(result.get('pixel_data', []))
            logger.info(f"Extracted {pixel_count} real pixels for K-means clustering!")
            
            if pixel_count > 0:
                logger.info(f"SUCCESS! Found valid pixels in tile {tile['name']}")
                
                # Show sample pixels
                sample_pixels = result['pixel_data'][:5]  # First 5 pixels
                logger.info("Sample pixel features (first 5):")
                for i, pixel in enumerate(sample_pixels):
                    logger.info(f"   Pixel {i+1}: [NDVI={pixel[0]:.3f}, Red={pixel[1]:.0f}, NIR={pixel[2]:.0f}, Lat={pixel[3]:.6f}, Lng={pixel[4]:.6f}]")
                
                # Show statistics
                stats = result['statistics']
                logger.info("============================================================")
                logger.info("📊 EXTRACTION RESULTS:")
                logger.info(f"⏱️  Processing Time: {result.get('processing_time', 'N/A')}")
                logger.info(f"🎯 Pixels Extracted: {pixel_count}")
                logger.info(f"📈 Mean NDVI: {stats['mean_ndvi']:.3f}")
                logger.info(f"🌿 Vegetation Coverage: {stats['vegetation_coverage']:.1f}%")
                logger.info(f"🗺️  CRS: {result.get('crs', 'N/A')}")
                return True
                
            else:
                logger.warning(f"⚠️ No pixels extracted from tile {tile['name']} - trying next tile...")
                continue
                
        except Exception as e:
            logger.error(f"❌ Error testing tile {tile['name']}: {str(e)}")
            continue
    
    # If we get here, no tiles worked
    logger.error("❌ No valid pixels found in any test tiles")
    logger.error("❌ All test regions appear to be masked (clouds/water/no-data)")
    return False

if __name__ == "__main__":
    logger.info("=" * 70)
    logger.info("🎯 No S3 dependencies - Pure extraction test")
    logger.info("=" * 70)
    
    success = test_pixel_extraction()
    
    if success:
        logger.info("✅ Ready for S3 integration and Lambda deployment")
    else:
        logger.error("❌ Fix extraction issues before proceeding")
    
    logger.info("=" * 70) 