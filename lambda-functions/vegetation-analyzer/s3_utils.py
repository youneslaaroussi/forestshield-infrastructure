import logging
import boto3
import rasterio
from rasterio.crs import CRS
import numpy as np
from typing import Dict, Any, Tuple, List
import tempfile
import os
from datetime import datetime
import json
import io

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
    
    def upload_ndvi_result(self, image_id: str, statistics: Dict[str, Any] = None, 
                          pixel_data: List[List[float]] = None) -> Tuple[str, str]:
        """
        Upload NDVI statistics and REAL pixel data to S3
        
        Args:
            image_id: Unique image identifier
            statistics: NDVI statistics dictionary
            pixel_data: Real pixel data arrays [[ndvi, red, nir, lat, lng], ...] 
            
        Returns:
            Tuple of (ndvi_output_path, sagemaker_training_data_path)
        """
        
        # Upload JSON statistics
        ndvi_output = self.upload_ndvi_statistics_only(image_id, statistics)
        
        # Upload REAL pixel data for SageMaker training
        if pixel_data and len(pixel_data) > 0:
            sagemaker_training_data = self.upload_real_pixel_data(image_id, pixel_data)
        else:
            # Fallback for backward compatibility - but log warning
            logger.warning("⚠️ No pixel data provided - using deprecated synthetic data fallback")
            sagemaker_training_data = self.upload_sagemaker_training_data_deprecated(image_id, statistics)
        
        return ndvi_output, sagemaker_training_data
    
    def upload_ndvi_statistics_only(self, image_id: str, statistics: Dict[str, Any] = None) -> str:
        """
        Upload NDVI statistics as JSON file when processing in chunked mode
        
        Args:
            image_id: Unique image identifier
            statistics: NDVI statistics dictionary to upload
            
        Returns:
            S3 path to uploaded statistics file
        """
        
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
    
    def upload_sagemaker_training_data(self, image_id: str, statistics: Dict[str, Any]) -> str:
        """
        Upload SageMaker K-means training data in CSV format
        
        Args:
            image_id: Unique image identifier
            statistics: NDVI statistics to convert to training data
            
        Returns:
            S3 path to uploaded training data CSV
        """
        
        import csv
        import io
        
        # Generate S3 key with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"sagemaker-training/{timestamp}/{image_id}_training.csv"
        s3_path = f"s3://{self.bucket_name}/{s3_key}"
        
        logger.info(f"🤖 Creating SageMaker training data CSV for {s3_path}")
        
        try:
            # Create CSV content from NDVI statistics
            # For K-means clustering, we'll use mean_ndvi and vegetation_coverage as features
            csv_content = io.StringIO()
            writer = csv.writer(csv_content)
            
            # CSV format for SageMaker K-means: feature1,feature2 (no headers, no labels)
            # Using NDVI stats to create synthetic training points for clustering
            mean_ndvi = statistics.get('mean_ndvi', 0.5)
            vegetation_coverage = statistics.get('vegetation_coverage', 50.0)
            
            # Generate training data points around the calculated statistics
            # This simulates pixel-level data for clustering
            training_points = []
            
            # Generate points around mean NDVI and vegetation coverage
            for i in range(100):  # 100 training points
                # Add some variance around the mean values
                ndvi_point = mean_ndvi + np.random.normal(0, statistics.get('std_ndvi', 0.1))
                veg_point = vegetation_coverage + np.random.normal(0, 10.0)
                
                # Clamp values to valid ranges
                ndvi_point = max(-1.0, min(1.0, ndvi_point))
                veg_point = max(0.0, min(100.0, veg_point))
                
                training_points.append([ndvi_point, veg_point])
            
            # Write training points to CSV
            for point in training_points:
                writer.writerow(point)
            
            csv_data = csv_content.getvalue()
            csv_content.close()
            
            # Upload CSV to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=csv_data,
                ContentType='text/csv',
                Metadata={
                    'image-id': image_id,
                    'processing-date': datetime.now().isoformat(),
                    'content-type': 'sagemaker-training-csv',
                    'training-points': str(len(training_points))
                }
            )
            
            logger.info(f"✅ SageMaker training data uploaded to {s3_path}")
            return s3_path
            
        except Exception as e:
            logger.error(f"❌ Failed to upload SageMaker training data: {str(e)}")
            raise RuntimeError(f"SageMaker training data upload failed: {str(e)}")

    def upload_real_pixel_data(self, image_id: str, pixel_data: List[List[float]]) -> str:
        """
        Upload REAL pixel data for SageMaker K-means training
        
        Multi-Feature Clustering with Feature Scaling
        - 5 features: [ndvi, red, nir, lat, lng]
        - Feature normalization for different value ranges
        - Optimized for SageMaker K-means algorithm
        
        Args:
            image_id: Unique image identifier
            pixel_data: Real pixel data arrays [[ndvi, red, nir, lat, lng], ...]
             
        Returns:
            S3 path to uploaded pixel data CSV
        """
        
        import csv
        import io
        import numpy as np
        
        # Generate S3 key with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"sagemaker-training/{timestamp}/{image_id}_real_pixel_5features.csv"
        s3_path = f"s3://{self.bucket_name}/{s3_key}"
        
        logger.info(f"Creating enhanced K-means training data with feature scaling")
        logger.info(f"Target: {s3_path}")
        logger.info(f"Features: [NDVI, Red, NIR, Latitude, Longitude]")
        
        try:
            if not pixel_data or len(pixel_data) == 0:
                raise ValueError("No pixel data provided for training")
            
            # Convert to numpy array for feature scaling
            pixel_array = np.array(pixel_data, dtype=np.float32)
            logger.info(f"📐 Input data shape: {pixel_array.shape}")
            
            # Feature Scaling Implementation (Manual MinMax Scaling)
            # Different features have very different ranges:
            # - NDVI: [-1, 1]
            # - Red/NIR bands: [0, 10000+] 
            # - Lat/Lng: [-90, 90] / [-180, 180]
            
            # Apply manual MinMax scaling to normalize all features to [0, 1]
            # Formula: (x - min) / (max - min)
            scaled_pixels = np.zeros_like(pixel_array)
            feature_mins = np.zeros(5)
            feature_maxs = np.zeros(5)
            feature_ranges = np.zeros(5)
            
            for i in range(5):  # 5 features
                feature_min = pixel_array[:, i].min()
                feature_max = pixel_array[:, i].max()
                feature_range = feature_max - feature_min
                
                feature_mins[i] = feature_min
                feature_maxs[i] = feature_max
                feature_ranges[i] = feature_range
                
                # Avoid division by zero for constant features
                if feature_range > 0:
                    scaled_pixels[:, i] = (pixel_array[:, i] - feature_min) / feature_range
                else:
                    scaled_pixels[:, i] = 0.0  # All values are the same
            
            logger.info("MANUAL FEATURE SCALING APPLIED:")
            logger.info(f"   Original ranges:")
            for i, feature in enumerate(['NDVI', 'Red', 'NIR', 'Lat', 'Lng']):
                logger.info(f"     {feature}: [{feature_mins[i]:.3f}, {feature_maxs[i]:.3f}]")
            
            logger.info(f"   Scaled ranges: [0.000, 1.000] for all features")
            logger.info(f"   Scaling metadata saved for model inference")
            
            # Create CSV content with scaled features
            csv_content = io.StringIO()
            writer = csv.writer(csv_content)
            
            # SageMaker K-means format: feature1,feature2,feature3,feature4,feature5 (no headers)
            for pixel in scaled_pixels:
                writer.writerow([f"{val:.6f}" for val in pixel])
            
            csv_data = csv_content.getvalue()
            csv_content.close()
            
            # Store scaling parameters for later use in model inference
            scaler_metadata = {
                'feature_names': ['NDVI', 'Red', 'NIR', 'Latitude', 'Longitude'],
                'scaler_type': 'ManualMinMaxScaler',
                'feature_mins': feature_mins.tolist(),
                'feature_maxs': feature_maxs.tolist(),
                'feature_ranges': feature_ranges.tolist(),
                'feature_range': [0, 1],
                'original_ranges': {
                    'NDVI': [float(feature_mins[0]), float(feature_maxs[0])],
                    'Red': [float(feature_mins[1]), float(feature_maxs[1])],
                    'NIR': [float(feature_mins[2]), float(feature_maxs[2])],
                    'Latitude': [float(feature_mins[3]), float(feature_maxs[3])],
                    'Longitude': [float(feature_mins[4]), float(feature_maxs[4])]
                }
            }
            
            # Upload CSV to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=csv_data,
                ContentType='text/csv',
                Metadata={
                    'image-id': image_id,
                    'processing-date': datetime.now().isoformat(),
                    'content-type': 'sagemaker-training-csv-5features-scaled',
                    'training-points': str(len(scaled_pixels)),
                    'features': 'ndvi,red,nir,latitude,longitude',
                    'scaling': 'minmax-0-1',
                }
            )
            
            # Also upload scaler metadata
            scaler_s3_key = f"sagemaker-training/{timestamp}/{image_id}_scaler_metadata.json"
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=scaler_s3_key,
                Body=json.dumps(scaler_metadata, indent=2),
                ContentType='application/json',
                Metadata={
                    'image-id': image_id,
                    'content-type': 'feature-scaler-metadata'
                }
            )
            
            # Store raw, unscaled geospatial data for heatmap analysis
            self.upload_raw_geospatial_data(image_id, pixel_array)

            logger.info(f"Enhanced K-means training data uploaded to {s3_path}")
            logger.info(f"Features: {len(scaled_pixels)} pixels × 5 dimensions")
            logger.info(f"Scaler metadata: s3://{self.bucket_name}/{scaler_s3_key}")
            
            return s3_path
            
        except Exception as e:
            logger.error(f"❌ Failed to upload enhanced pixel data: {str(e)}")
            raise RuntimeError(f"Enhanced pixel data upload failed: {str(e)}")

    def upload_raw_geospatial_data(self, image_id: str, pixel_array: np.ndarray) -> str:
        """
        Uploads raw, unscaled pixel data to S3 for geospatial (Athena) queries.
        
        Args:
            image_id: Unique image identifier.
            pixel_array: Numpy array of unscaled pixel data [ndvi, red, nir, lat, lng].
        
        Returns:
            S3 path to the uploaded geospatial data.
        """
        
        try:
            now = datetime.utcnow()
            year = now.strftime('%Y')
            month = now.strftime('%m')
            day = now.strftime('%d')
            
            s3_key = f"geospatial-data/year={year}/month={month}/day={day}/{image_id}.jsonl"
            s3_path = f"s3://{self.bucket_name}/{s3_key}"
            
            logger.info(f"Uploading raw geospatial data for Athena to {s3_path}")
            
            # Convert numpy array to JSON Lines format
            jsonl_content = io.StringIO()
            for row in pixel_array:
                data = {
                    "image_id": image_id,
                    "timestamp": now.isoformat(),
                    "ndvi": float(row[0]),
                    "red": int(row[1]),
                    "nir": int(row[2]),
                    "latitude": float(row[3]),
                    "longitude": float(row[4])
                }
                jsonl_content.write(json.dumps(data) + '\\n')
            
            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=jsonl_content.getvalue(),
                ContentType='application/json-lines'
            )
            
            logger.info(f"✅ Geospatial data for {len(pixel_array)} pixels uploaded successfully.")
            return s3_path
            
        except Exception as e:
            logger.error(f"❌ Failed to upload raw geospatial data: {str(e)}")
            # This is a non-critical error for the main pipeline, so we just log it
            return ""

    def upload_sagemaker_training_data_deprecated(self, image_id: str, statistics: Dict[str, Any]) -> str:
        """
        Upload SageMaker K-means training data in CSV format (deprecated)
        
        Args:
            image_id: Unique image identifier
            statistics: NDVI statistics to convert to training data
            
        Returns:
            S3 path to uploaded training data CSV
        """
        
        import csv
        import io
        
        # Generate S3 key with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        s3_key = f"sagemaker-training/{timestamp}/{image_id}_training_deprecated.csv"
        s3_path = f"s3://{self.bucket_name}/{s3_key}"
        
        logger.info(f"🤖 Creating SageMaker training data CSV for {s3_path}")
        
        try:
            # Create CSV content from NDVI statistics
            # For K-means clustering, we'll use mean_ndvi and vegetation_coverage as features
            csv_content = io.StringIO()
            writer = csv.writer(csv_content)
            
            # CSV format for SageMaker K-means: feature1,feature2 (no headers, no labels)
            # Using NDVI stats to create synthetic training points for clustering
            mean_ndvi = statistics.get('mean_ndvi', 0.5)
            vegetation_coverage = statistics.get('vegetation_coverage', 50.0)
            
            # Generate training data points around the calculated statistics
            # This simulates pixel-level data for clustering
            training_points = []
            
            # Generate points around mean NDVI and vegetation coverage
            for i in range(100):  # 100 training points
                # Add some variance around the mean values
                ndvi_point = mean_ndvi + np.random.normal(0, statistics.get('std_ndvi', 0.1))
                veg_point = vegetation_coverage + np.random.normal(0, 10.0)
                
                # Clamp values to valid ranges
                ndvi_point = max(-1.0, min(1.0, ndvi_point))
                veg_point = max(0.0, min(100.0, veg_point))
                
                training_points.append([ndvi_point, veg_point])
            
            # Write training points to CSV
            for point in training_points:
                writer.writerow(point)
            
            csv_data = csv_content.getvalue()
            csv_content.close()
            
            # Upload CSV to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=s3_key,
                Body=csv_data,
                ContentType='text/csv',
                Metadata={
                    'image-id': image_id,
                    'processing-date': datetime.now().isoformat(),
                    'content-type': 'sagemaker-training-csv',
                    'training-points': str(len(training_points))
                }
            )
            
            logger.info(f"✅ SageMaker training data uploaded to {s3_path}")
            return s3_path
            
        except Exception as e:
            logger.error(f"❌ Failed to upload SageMaker training data: {str(e)}")
            raise RuntimeError(f"SageMaker training data upload failed: {str(e)}") 