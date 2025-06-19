import logging
import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.enums import Resampling
from typing import Dict, Tuple, Any
import tempfile
import os

logger = logging.getLogger(__name__)

class VegetationProcessor:
    """
    Vegetation analysis processor using rasterio and GeoLambda
    
    Calculates NDVI (Normalized Difference Vegetation Index) from Sentinel-2 satellite imagery.
    NDVI = (NIR - Red) / (NIR + Red)
    
    MEMORY OPTIMIZED - Processes images in chunks to avoid Lambda memory limits
    """
    
    def __init__(self, chunk_size: int = 1024):
        """Initialize the vegetation processor with chunked processing"""
        logger.info("🌱 Initializing VegetationProcessor with chunked processing")
        self.chunk_size = chunk_size  # Process in 1024x1024 pixel chunks (reduced from 2048)
        
        # NDVI thresholds for classification
        self.thresholds = {
            'water_snow': -1.0,
            'bare_soil': 0.1,
            'sparse_vegetation': 0.3,
            'moderate_vegetation': 0.6,
            'dense_vegetation': 1.0
        }
    
    def calculate_ndvi_from_urls(self, red_url: str, nir_url: str, image_id: str) -> Dict[str, Any]:
        """
        Calculate NDVI from red and NIR band URLs using chunked processing
        
        Args:
            red_url: URL to red band (B04) - usually JPEG2000 format
            nir_url: URL to NIR band (B08) - usually JPEG2000 format  
            image_id: Unique identifier for the image
            
        Returns:
            Dictionary containing NDVI statistics and metadata (no full array to save memory)
        """
        
        logger.info(f"🔍 Opening satellite bands for image: {image_id}")
        
        try:
            # Open both bands directly from URLs
            with rasterio.open(red_url) as red_src:
                with rasterio.open(nir_url) as nir_src:
                    
                    # Log band information
                    logger.info(f"🔴 Red band: {red_src.width}x{red_src.height}, CRS: {red_src.crs}")
                    logger.info(f"🟢 NIR band: {nir_src.width}x{nir_src.height}, CRS: {nir_src.crs}")
                    
                    # Process in chunks to avoid memory issues
                    logger.info(f"🧩 Processing image in {self.chunk_size}x{self.chunk_size} chunks...")
                    statistics = self._calculate_ndvi_chunked(red_src, nir_src)
                    
                    return {
                        'statistics': statistics,
                        'crs': str(red_src.crs),
                        'bounds': red_src.bounds
                    }
                    
        except Exception as e:
            logger.error(f"❌ Failed to process bands: {str(e)}")
            raise RuntimeError(f"NDVI calculation failed: {str(e)}")
    
    def _calculate_ndvi_chunked(self, red_src: rasterio.DatasetReader, 
                                nir_src: rasterio.DatasetReader) -> Dict[str, float]:
        """
        Calculate NDVI statistics by processing image in chunks
        
        Args:
            red_src: Red band rasterio dataset
            nir_src: NIR band rasterio dataset
            
        Returns:
            Dictionary with aggregated NDVI statistics
        """
        
        # Initialize accumulators for statistics
        all_ndvi_values = []
        total_pixels = 0
        valid_pixels = 0
        
        # Classification counters
        water_snow_count = 0
        bare_soil_count = 0
        sparse_veg_count = 0
        moderate_veg_count = 0
        dense_veg_count = 0
        vegetation_pixels = 0
        
        # Get image dimensions
        height, width = red_src.height, red_src.width
        
        # Process image in chunks
        for row in range(0, height, self.chunk_size):
            for col in range(0, width, self.chunk_size):
                
                # Calculate window size (handle edge cases)
                window_height = min(self.chunk_size, height - row)
                window_width = min(self.chunk_size, width - col)
                window = Window(col, row, window_width, window_height)
                
                # Read chunk data
                red_chunk = red_src.read(1, window=window, masked=True)
                nir_chunk = nir_src.read(1, window=window, masked=True)
                
                # Calculate NDVI for this chunk
                ndvi_chunk = self._calculate_ndvi_chunk(red_chunk, nir_chunk)
                
                # Get valid values for statistics
                valid_mask = ~ndvi_chunk.mask if hasattr(ndvi_chunk, 'mask') else ~np.isnan(ndvi_chunk)
                valid_ndvi = ndvi_chunk[valid_mask] if hasattr(ndvi_chunk, 'mask') else ndvi_chunk[~np.isnan(ndvi_chunk)]
                
                # Ensure valid_ndvi is a 1D array
                if hasattr(valid_ndvi, 'flatten'):
                    valid_ndvi = valid_ndvi.flatten()
                
                if len(valid_ndvi) > 0:
                    # Add to overall statistics
                    sample_size = min(len(valid_ndvi), 500)
                    if len(valid_ndvi) > sample_size:
                        indices = np.random.choice(len(valid_ndvi), sample_size, replace=False)
                        sampled_ndvi = valid_ndvi[indices]
                    else:
                        sampled_ndvi = valid_ndvi
                    
                    # Ensure sampled_ndvi is flattened and convert to list of floats
                    if hasattr(sampled_ndvi, 'flatten'):
                        sampled_ndvi = sampled_ndvi.flatten()
                    
                    # Convert to Python floats to avoid numpy array issues
                    sampled_values = [float(val) for val in sampled_ndvi if not np.isnan(val) and not np.isinf(val)]
                    all_ndvi_values.extend(sampled_values)
                    
                    # Limit total samples to avoid memory issues (keep only most recent 50k samples)
                    if len(all_ndvi_values) > 50000:
                        # Keep a representative sample from the collected values
                        all_ndvi_values = all_ndvi_values[-25000:]  # Keep last 25k samples
                    
                    # Count classifications
                    water_snow_count += np.sum(valid_ndvi < self.thresholds['bare_soil'])
                    bare_soil_count += np.sum((valid_ndvi >= self.thresholds['bare_soil']) & 
                                            (valid_ndvi < self.thresholds['sparse_vegetation']))
                    sparse_veg_count += np.sum((valid_ndvi >= self.thresholds['sparse_vegetation']) & 
                                             (valid_ndvi < self.thresholds['moderate_vegetation']))
                    moderate_veg_count += np.sum((valid_ndvi >= self.thresholds['moderate_vegetation']) & 
                                                (valid_ndvi < self.thresholds['dense_vegetation']))
                    dense_veg_count += np.sum(valid_ndvi >= self.thresholds['moderate_vegetation'])
                    vegetation_pixels += np.sum(valid_ndvi > 0.3)
                
                valid_pixels += len(valid_ndvi) if len(valid_ndvi) > 0 else 0
                total_pixels += window_height * window_width
        
        logger.info(f"✅ Processed {total_pixels:,} total pixels, {valid_pixels:,} valid pixels")
        
        # Calculate final statistics
        if len(all_ndvi_values) == 0:
            logger.warning("⚠️ No valid NDVI pixels found!")
            return {
                'mean_ndvi': 0.0,
                'min_ndvi': 0.0,
                'max_ndvi': 0.0,
                'std_ndvi': 0.0,
                'vegetation_coverage': 0.0,
                'valid_pixels': 0,
                'total_pixels': total_pixels
            }
        
        # Now we have a flat list of Python floats - safe to convert to numpy array
        all_ndvi_array = np.array(all_ndvi_values, dtype=np.float32)
        vegetation_coverage = (vegetation_pixels / valid_pixels) * 100.0 if valid_pixels > 0 else 0.0
        
        return {
            'mean_ndvi': float(np.mean(all_ndvi_array)),
            'min_ndvi': float(np.min(all_ndvi_array)),
            'max_ndvi': float(np.max(all_ndvi_array)),
            'std_ndvi': float(np.std(all_ndvi_array)),
            'vegetation_coverage': float(vegetation_coverage),
            'valid_pixels': int(valid_pixels),
            'total_pixels': int(total_pixels),
            'classification': {
                'water_snow_percent': float(water_snow_count / valid_pixels * 100) if valid_pixels > 0 else 0.0,
                'bare_soil_percent': float(bare_soil_count / valid_pixels * 100) if valid_pixels > 0 else 0.0,
                'sparse_vegetation_percent': float(sparse_veg_count / valid_pixels * 100) if valid_pixels > 0 else 0.0,
                'moderate_vegetation_percent': float(moderate_veg_count / valid_pixels * 100) if valid_pixels > 0 else 0.0,
                'dense_vegetation_percent': float(dense_veg_count / valid_pixels * 100) if valid_pixels > 0 else 0.0
            }
        }
    
    def _calculate_ndvi_chunk(self, red: np.ndarray, nir: np.ndarray) -> np.ndarray:
        """
        Calculate NDVI for a single chunk
        
        Args:
            red: Red band chunk (masked array)
            nir: NIR band chunk (masked array)
            
        Returns:
            NDVI array for the chunk
        """
        
        # Convert to float32 to prevent overflow
        red = red.astype(np.float32)
        nir = nir.astype(np.float32)
        
        # Calculate NDVI with safe division
        numerator = nir - red
        denominator = nir + red
        
        # Avoid division by zero
        with np.errstate(divide='ignore', invalid='ignore'):
            ndvi = np.divide(numerator, denominator, 
                           out=np.full_like(numerator, np.nan), 
                           where=(denominator != 0))
        
        # Mask invalid values
        ndvi_masked = np.ma.masked_where(
            (denominator == 0) | (ndvi < -1) | (ndvi > 1), 
            ndvi
        )
        
        return ndvi_masked 