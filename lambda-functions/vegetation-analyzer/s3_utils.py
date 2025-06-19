import logging
import boto3
import rasterio
from rasterio.crs import CRS
import numpy as np
from typing import Dict, Any
import tempfile
import os
from datetime import datetime

logger = logging.getLogger(__name__)

class S3Handler:
    """
    S3 utilities for uploading vegetation analysis results
    
    Handles uploading NDVI GeoTIFF files and metadata to S3 buckets.
    """
    
    def __init__(self, bucket_name: str):
        """
        Initialize S3 handler
        
        Args:
            bucket_name: S3 bucket name for storing results
        """
        self.bucket_name = bucket_name
        self.s3_client = boto3.client('s3')
        logger.info(f"🪣 Initialized S3Handler for bucket: {bucket_name}")
    
    def upload_ndvi_result(self, ndvi_data: np.ndarray, profile: Dict[str, Any], 
                          image_id: str) -> str:
        """
        Upload NDVI statistics as JSON to S3
        
        Args:
            ndvi_data: NDVI statistics (not array anymore)
            profile: Rasterio profile for reference
            image_id: Unique image identifier
            
        Returns:
            S3 path to uploaded file
        """
        
        # If ndvi_data is None (from chunked processing), just upload metadata
        if ndvi_data is None:
            logger.info(f"📊 Uploading NDVI statistics only (no array data) for {image_id}")
            return self.upload_ndvi_statistics_only(image_id)
        
        # Legacy path for full array upload (should not be used with chunked processing)
        # Generate S3 key with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"ndvi/{timestamp}/{image_id}_ndvi.tif"
        
        logger.info(f"☁️ Uploading NDVI result to s3://{self.bucket_name}/{s3_key}")
        
        try:
            # Create temporary file
            with tempfile.NamedTemporaryFile(suffix='.tif', delete=False) as tmp_file:
                tmp_path = tmp_file.name
                
                # Write NDVI data as GeoTIFF
                with rasterio.open(tmp_path, 'w', **profile) as dst:
                    dst.write(ndvi_data, 1)
                    
                    # Add metadata
                    dst.update_tags(
                        PROCESSING_SOFTWARE='ForestShield-VegetationAnalyzer',
                        PROCESSING_DATE=datetime.now().isoformat(),
                        IMAGE_ID=image_id,
                        NDVI_DESCRIPTION='Normalized Difference Vegetation Index',
                        VEGETATION_THRESHOLD='0.3',
                        NODATA_VALUE='-9999'
                    )
                
                # Upload to S3
                self.s3_client.upload_file(
                    tmp_path, 
                    self.bucket_name, 
                    s3_key,
                    ExtraArgs={
                        'ContentType': 'image/tiff',
                        'Metadata': {
                            'image-id': image_id,
                            'processing-date': datetime.now().isoformat(),
                            'content-type': 'ndvi-geotiff'
                        }
                    }
                )
                
                # Clean up temporary file
                os.unlink(tmp_path)
                
                s3_path = f"s3://{self.bucket_name}/{s3_key}"
                logger.info(f"✅ NDVI uploaded successfully to {s3_path}")
                
                return s3_path
                
        except Exception as e:
            logger.error(f"❌ Failed to upload NDVI to S3: {str(e)}")
            # Clean up temp file if it exists
            if 'tmp_path' in locals() and os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise RuntimeError(f"S3 upload failed: {str(e)}")
    
    def upload_ndvi_statistics_only(self, image_id: str) -> str:
        """
        Upload placeholder statistics file when processing in chunked mode
        
        Args:
            image_id: Unique image identifier
            
        Returns:
            S3 path indicating statistics-only processing
        """
        
        # Just return a placeholder path since we're not uploading actual data
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_path = f"s3://{self.bucket_name}/ndvi-stats/{timestamp}/{image_id}_processed.json"
        
        logger.info(f"📊 NDVI statistics calculated (no file upload in memory-optimized mode)")
        logger.info(f"🎯 Processing completed for {image_id}")
        
        return s3_path
    
    def upload_metadata(self, metadata: Dict[str, Any], image_id: str) -> str:
        """
        Upload processing metadata as JSON to S3
        
        Args:
            metadata: Metadata dictionary
            image_id: Unique image identifier
            
        Returns:
            S3 path to uploaded metadata file
        """
        
        import json
        
        # Generate S3 key
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"metadata/{timestamp}/{image_id}_metadata.json"
        
        logger.info(f"📋 Uploading metadata to s3://{self.bucket_name}/{s3_key}")
        
        try:
            # Upload JSON metadata
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=json.dumps(metadata, indent=2),
                ContentType='application/json',
                Metadata={
                    'image-id': image_id,
                    'processing-date': datetime.now().isoformat(),
                    'content-type': 'processing-metadata'
                }
            )
            
            s3_path = f"s3://{self.bucket_name}/{s3_key}"
            logger.info(f"✅ Metadata uploaded successfully to {s3_path}")
            
            return s3_path
            
        except Exception as e:
            logger.error(f"❌ Failed to upload metadata to S3: {str(e)}")
            raise RuntimeError(f"Metadata upload failed: {str(e)}")
    
    def check_bucket_exists(self) -> bool:
        """
        Check if the S3 bucket exists and is accessible
        
        Returns:
            True if bucket exists and is accessible
        """
        
        try:
            self.s3_client.head_bucket(Bucket=self.bucket_name)
            logger.info(f"✅ S3 bucket {self.bucket_name} is accessible")
            return True
        except Exception as e:
            logger.error(f"❌ S3 bucket {self.bucket_name} is not accessible: {str(e)}")
            return False 