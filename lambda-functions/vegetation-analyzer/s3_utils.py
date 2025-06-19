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
    
    def upload_ndvi_result(self, image_id: str, statistics: Dict[str, Any] = None) -> str:
        """
        Upload NDVI statistics as JSON to S3
        
        Args:
            image_id: Unique image identifier
            statistics: NDVI statistics dictionary
            
        Returns:
            S3 path to uploaded file
        """
        
        return self.upload_ndvi_statistics_only(image_id, statistics)
    
    def upload_ndvi_statistics_only(self, image_id: str, statistics: Dict[str, Any] = None) -> str:
        """
        Upload NDVI statistics as JSON file when processing in chunked mode
        
        Args:
            image_id: Unique image identifier
            statistics: NDVI statistics dictionary to upload
            
        Returns:
            S3 path to uploaded statistics file
        """
        
        import json
        
        # Generate S3 key with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"ndvi-stats/{timestamp}/{image_id}_processed.json"
        s3_path = f"s3://{self.bucket_name}/{s3_key}"
        
        logger.info(f"📊 Uploading NDVI statistics as JSON to {s3_path}")
        
        try:
            # Prepare statistics data for upload
            upload_data = {
                'image_id': image_id,
                'processing_date': datetime.now().isoformat(),
                'processing_mode': 'chunked_memory_optimized',
                'statistics': statistics or {},
                'metadata': {
                    'processing_software': 'ForestShield-VegetationAnalyzer',
                    'ndvi_description': 'Normalized Difference Vegetation Index Statistics',
                    'vegetation_threshold': 0.3
                }
            }
            
            # Upload JSON statistics
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=json.dumps(upload_data, indent=2),
                ContentType='application/json',
                Metadata={
                    'image-id': image_id,
                    'processing-date': datetime.now().isoformat(),
                    'content-type': 'ndvi-statistics-json'
                }
            )
            
            logger.info(f"✅ NDVI statistics uploaded successfully to {s3_path}")
            return s3_path
            
        except Exception as e:
            logger.error(f"❌ Failed to upload NDVI statistics to S3: {str(e)}")
            raise RuntimeError(f"NDVI statistics upload failed: {str(e)}")
    
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