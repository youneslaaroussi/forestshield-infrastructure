import logging
import numpy as np
import rasterio
from rasterio.windows import Window
from rasterio.enums import Resampling
from rasterio.transform import xy
from typing import Dict, Tuple, Any, List
import tempfile
import os
from pyproj import Proj, Transformer, CRS

logger = logging.getLogger(__name__)

class VegetationProcessor:
    """
    Vegetation analysis processor using rasterio and GeoLambda
    
    Calculates NDVI (Normalized Difference Vegetation Index) from Sentinel-2 satellite imagery.
    NDVI = (NIR - Red) / (NIR + Red)
    
    PHASE 1 ENHANCEMENT: Now extracts real pixel data arrays with spatial coordinates
    for K-means clustering instead of just statistical summaries.
    """
    
    def __init__(self, chunk_size: int = 1024, max_pixels_per_image: int = 25000):
        """Initialize the vegetation processor with pixel data extraction capabilities"""
        logger.info("🌱 Initializing VegetationProcessor with REAL PIXEL DATA extraction")
        self.chunk_size = chunk_size  # Process in 1024x1024 pixel chunks
        self.max_pixels_per_image = max_pixels_per_image  # Limit pixels to avoid memory issues
        
        # NDVI thresholds for classification (kept for backward compatibility)
        self.thresholds = {
            'water_snow': -1.0,
            'bare_soil': 0.1,
            'sparse_vegetation': 0.3,
            'moderate_vegetation': 0.6,
            'dense_vegetation': 1.0
        }
    
    def calculate_ndvi_from_urls(self, red_url: str, nir_url: str, image_id: str) -> Dict[str, Any]:
        """
        Calculate NDVI and extract real pixel data with spatial coordinates
        
        PHASE 1 ENHANCEMENT: Now returns both statistics AND pixel arrays for K-means clustering
        
        Args:
            red_url: URL to red band (B04) - usually JPEG2000 format
            nir_url: URL to NIR band (B08) - usually JPEG2000 format  
            image_id: Unique identifier for the image
            
        Returns:
            Dictionary containing:
            - statistics: NDVI statistics (backward compatibility)
            - pixel_data: Array of pixel features [ndvi, red, nir, lat, lng]
            - spatial_metadata: CRS and bounds information
        """
        
        logger.info(f"🔍 Opening satellite bands for REAL PIXEL EXTRACTION: {image_id}")
        
        try:
            # Open both bands directly from URLs
            with rasterio.open(red_url) as red_src:
                with rasterio.open(nir_url) as nir_src:
                    
                    # Log band information
                    logger.info(f"🔴 Red band: {red_src.width}x{red_src.height}, CRS: {red_src.crs}")
                    logger.info(f"🟢 NIR band: {nir_src.width}x{nir_src.height}, CRS: {nir_src.crs}")
                    
                    # PHASE 1: Extract pixel arrays with coordinates
                    logger.info(f"🧩 Extracting pixel data in {self.chunk_size}x{self.chunk_size} chunks...")
                    statistics, pixel_data = self._extract_pixel_data_chunked(red_src, nir_src)
                    
                    logger.info(f"✅ Extracted {len(pixel_data)} real pixels for K-means clustering!")
                    
                    return {
                        'statistics': statistics,  # Backward compatibility
                        'pixel_data': pixel_data,  # NEW: Real pixel arrays for K-means
                        'spatial_metadata': {
                            'crs': str(red_src.crs),
                            'bounds': red_src.bounds,
                            'transform': red_src.transform,
                            'width': red_src.width,
                            'height': red_src.height
                        }
                    }
                    
        except Exception as e:
            logger.error(f"❌ Failed to process bands: {str(e)}")
            raise RuntimeError(f"NDVI calculation failed: {str(e)}")
    
    def _extract_pixel_data_chunked(self, red_src: rasterio.DatasetReader, 
                                   nir_src: rasterio.DatasetReader) -> Tuple[Dict[str, float], List[List[float]]]:
        """
        PHASE 1: Extract real pixel data with spatial coordinates from satellite imagery
        """
        
        height, width = red_src.height, red_src.width
        transform = red_src.transform
        
        logger.info(f"🔴 Red band: {width}x{height}, CRS: {red_src.crs}")
        logger.info(f"🟢 NIR band: {width}x{height}, CRS: {nir_src.crs}")
        
        # Calculate sampling rate based on image size and target pixel count
        total_pixels = height * width
        sampling_rate = max(1, int(np.sqrt(total_pixels / self.max_pixels_per_image)))
        
        # IMPORTANT: Ensure sampling rate isn't too sparse for chunk size
        # We want at least 10-20 pixels sampled per chunk
        max_sampling_rate = self.chunk_size // 8  # At least 8x8 = 64 pixels per chunk
        sampling_rate = min(sampling_rate, max_sampling_rate)
        
        logger.info(f"🧩 Extracting pixel data in {self.chunk_size}x{self.chunk_size} chunks...")
        logger.info(f"🎯 Using sampling rate: every {sampling_rate}th pixel (target: {self.max_pixels_per_image} pixels)")
        logger.info(f"🔢 Expected pixels per chunk: ~{(self.chunk_size//sampling_rate)**2}")
        
        # DEBUGGING: Check overall image mask statistics first
        logger.info("🔍 DEBUGGING: Analyzing image mask patterns...")
        
        # Sample a few small regions to understand masking
        debug_regions = [
            (0, 0, 100, 100),           # Top-left corner
            (width//2-50, height//2-50, 100, 100),  # Center
            (width-100, height-100, 100, 100),      # Bottom-right
            (width//4, height//4, 100, 100),        # Quarter point
            (3*width//4, 3*height//4, 100, 100)     # Three-quarter point
        ]
        
        regions_with_vegetation = 0
        for i, (x, y, w, h) in enumerate(debug_regions):
            try:
                # Ensure we don't go out of bounds
                x = max(0, min(x, width - w))
                y = max(0, min(y, height - h))
                
                window = Window(x, y, w, h)
                red_sample = red_src.read(1, window=window)
                nir_sample = nir_src.read(1, window=window)
                
                # Check mask statistics and value ranges
                if hasattr(red_sample, 'mask'):
                    red_valid = (~red_sample.mask).sum()
                    red_total = red_sample.size
                    red_valid_pct = (red_valid / red_total) * 100
                    red_nonzero = (red_sample[~red_sample.mask] > 1).sum() if red_valid > 0 else 0
                else:
                    red_valid = (~np.isnan(red_sample)).sum()
                    red_total = red_sample.size
                    red_valid_pct = (red_valid / red_total) * 100
                    red_nonzero = (red_sample[~np.isnan(red_sample)] > 1).sum() if red_valid > 0 else 0
                
                if hasattr(nir_sample, 'mask'):
                    nir_valid = (~nir_sample.mask).sum()
                    nir_total = nir_sample.size
                    nir_valid_pct = (nir_valid / nir_total) * 100
                    nir_nonzero = (nir_sample[~nir_sample.mask] > 1).sum() if nir_valid > 0 else 0
                else:
                    nir_valid = (~np.isnan(nir_sample)).sum()
                    nir_total = nir_sample.size
                    nir_valid_pct = (nir_valid / nir_total) * 100
                    nir_nonzero = (nir_sample[~np.isnan(nir_sample)] > 1).sum() if nir_valid > 0 else 0
                
                # Check vegetation presence (non-zero reflectance values)
                vegetation_pixels = ((red_sample > 0) & (nir_sample > 0)).sum()
                vegetation_pct = (vegetation_pixels / red_sample.size) * 100
                
                logger.info(f"🔍 Region {i+1} [{y}:{x}] - Valid: R={red_valid_pct:.1f}% N={nir_valid_pct:.1f}%, Vegetation: {vegetation_pct:.1f}%")
                
                if vegetation_pct > 10:  # At least 10% vegetation
                    logger.info(f"✅ Found vegetation in region {i+1} with {vegetation_pct:.1f}% vegetation pixels!")
                    regions_with_vegetation += 1
                
            except Exception as e:
                logger.warning(f"⚠️ Error checking region {i+1}: {str(e)}")
        
        if regions_with_vegetation == 0:
            logger.error("❌ No vegetation regions found in entire image!")
            logger.error("💡 This image may be completely cloudy, water, or urban areas")
            
        # Continue with normal processing but focus on valid regions if found
        pixel_data = []
        all_ndvi_values = []
        
        # Statistics tracking (backward compatibility)
        valid_pixels = 0
        total_pixels = 0
        vegetation_pixels = 0
        water_snow_count = 0
        bare_soil_count = 0
        sparse_veg_count = 0
        moderate_veg_count = 0
        dense_veg_count = 0
        
        pixels_extracted = 0
        chunks_processed = 0
        chunks_with_valid_data = 0
        
        # Instead of processing chunks sequentially, prioritize vegetation-rich regions
        # Based on debug analysis, vegetation is typically in center/bottom regions
        # IMPORTANT: Use (col, row) format like debug regions that work!
        vegetation_priority_areas = [
            # Center region (where vegetation was found) - Debug region 2: (5440, 5440)
            (width//2 - 256, height//2 - 256, 512, 512),  # (col, row, w, h)
            # Bottom-right region  
            (width - 1024, height - 1024, 512, 512),      # (col, row, w, h)
            # Three-quarter region - Debug region 5: (8235, 8235)
            (3*width//4 - 256, 3*height//4 - 256, 512, 512),  # (col, row, w, h)
            # Quarter region
            (width//4 - 256, height//4 - 256, 512, 512),  # (col, row, w, h)
        ]
        
        # Try vegetation priority areas first
        for priority_col, priority_row, _, _ in vegetation_priority_areas:
            if len(pixel_data) >= self.max_pixels_per_image:
                break
                
            # Ensure we don't go out of bounds
            priority_row = max(0, min(priority_row, height - self.chunk_size))
            priority_col = max(0, min(priority_col, width - self.chunk_size))
            
            # Process this priority chunk
            red_chunk = red_src.read(1, window=Window(priority_col, priority_row, self.chunk_size, self.chunk_size))
            nir_chunk = nir_src.read(1, window=Window(priority_col, priority_row, self.chunk_size, self.chunk_size))
            ndvi_chunk = self._calculate_ndvi_chunk(red_chunk, nir_chunk)
            
            chunk_pixels = self._extract_chunk_pixel_data(
                red_chunk, nir_chunk, ndvi_chunk, transform,
                priority_row, priority_col, sampling_rate, str(red_src.crs)
            )
            
            if chunk_pixels:
                pixel_data.extend(chunk_pixels)
                chunks_with_valid_data += 1
                logger.info(f"🌱 Priority area [{priority_row}:{priority_col}] yielded {len(chunk_pixels)} pixels!")
            else:
                # Debug why priority areas with vegetation aren't yielding pixels
                logger.info(f"🔍 Priority area [{priority_row}:{priority_col}] debug:")
                logger.info(f"    Red chunk shape: {red_chunk.shape}, type: {type(red_chunk)}")
                logger.info(f"    Red values sample: min={np.min(red_chunk)}, max={np.max(red_chunk)}, mean={np.mean(red_chunk)}")
                logger.info(f"    NIR values sample: min={np.min(nir_chunk)}, max={np.max(nir_chunk)}, mean={np.mean(nir_chunk)}")
                logger.info(f"    Non-zero pixels: Red={np.sum(red_chunk > 0)}, NIR={np.sum(nir_chunk > 0)}")
                logger.info(f"    Sampling rate: {sampling_rate} (every {sampling_rate}th pixel)")
            
            chunks_processed += 1
        
        # If we still need more pixels, process remaining chunks normally
        if len(pixel_data) < self.max_pixels_per_image:
            logger.info(f"🔍 Got {len(pixel_data)} pixels from priority areas, processing remaining chunks...")
            
            # Process remaining chunks in normal order
            for chunk_row in range(0, height, self.chunk_size):
                if len(pixel_data) >= self.max_pixels_per_image:
                    break
                    
                for chunk_col in range(0, width, self.chunk_size):
                    if len(pixel_data) >= self.max_pixels_per_image:
                        break
                    
                    # Skip if we already processed this area in priority processing
                    already_processed = False
                    for priority_col, priority_row, _, _ in vegetation_priority_areas:
                        priority_row = max(0, min(priority_row, height - self.chunk_size))
                        priority_col = max(0, min(priority_col, width - self.chunk_size))
                        if abs(chunk_row - priority_row) < self.chunk_size and abs(chunk_col - priority_col) < self.chunk_size:
                            already_processed = True
                            break
                    
                    if already_processed:
                        continue
                    
                    # Read chunk
                    actual_height = min(self.chunk_size, height - chunk_row)
                    actual_width = min(self.chunk_size, width - chunk_col)
                    
                    red_chunk = red_src.read(1, window=Window(chunk_col, chunk_row, actual_width, actual_height))
                    nir_chunk = nir_src.read(1, window=Window(chunk_col, chunk_row, actual_width, actual_height))
                    ndvi_chunk = self._calculate_ndvi_chunk(red_chunk, nir_chunk)
                    
                    chunk_pixels = self._extract_chunk_pixel_data(
                        red_chunk, nir_chunk, ndvi_chunk, transform,
                        chunk_row, chunk_col, sampling_rate, str(red_src.crs)
                    )
                    
                    if chunk_pixels:
                        pixel_data.extend(chunk_pixels)
                        chunks_with_valid_data += 1
                    
                    chunks_processed += 1
        
        # Calculate basic statistics for backward compatibility
        total_pixels = height * width
        valid_pixels = len(pixel_data) * sampling_rate if pixel_data else 0  # Estimate based on extracted pixels
        
        # Basic statistics from extracted pixel data
        if pixel_data:
            ndvi_values = [pixel[0] for pixel in pixel_data]  # NDVI is first feature
            all_ndvi_values = ndvi_values
            
            # Count classifications
            water_snow_count = sum(1 for v in ndvi_values if v < self.thresholds['bare_soil'])
            bare_soil_count = sum(1 for v in ndvi_values if self.thresholds['bare_soil'] <= v < self.thresholds['sparse_vegetation'])
            sparse_veg_count = sum(1 for v in ndvi_values if self.thresholds['sparse_vegetation'] <= v < self.thresholds['moderate_vegetation'])
            moderate_veg_count = sum(1 for v in ndvi_values if self.thresholds['moderate_vegetation'] <= v < self.thresholds['dense_vegetation'])
            dense_veg_count = sum(1 for v in ndvi_values if v >= self.thresholds['dense_vegetation'])
            vegetation_pixels = sum(1 for v in ndvi_values if v > 0.3)
        else:
            all_ndvi_values = []
            water_snow_count = bare_soil_count = sparse_veg_count = moderate_veg_count = dense_veg_count = vegetation_pixels = 0
        
        logger.info(f"✅ Processed {total_pixels:,} total pixels, {valid_pixels:,} valid pixels")
        logger.info(f"🎯 Extracted {len(pixel_data)} real pixels for K-means clustering")
        
        # DEBUGGING: Add processing summary
        logger.info("🔍 PROCESSING SUMMARY:")
        logger.info(f"   📦 Chunks processed: {chunks_processed}")
        logger.info(f"   ✅ Chunks with valid data: {chunks_with_valid_data}")
        logger.info(f"   📊 Valid data percentage: {(chunks_with_valid_data/chunks_processed)*100:.1f}%")
        if chunks_with_valid_data == 0:
            logger.error("❌ CRITICAL: No chunks contain valid data - entire image is masked!")
            logger.error("💡 Try a different satellite image or date")
        
        # Calculate final statistics (backward compatibility)
        if len(all_ndvi_values) == 0:
            logger.warning("⚠️ No valid NDVI pixels found!")
            statistics = {
                'mean_ndvi': 0.0,
                'min_ndvi': 0.0,
                'max_ndvi': 0.0,
                'std_ndvi': 0.0,
                'vegetation_coverage': 0.0,
                'valid_pixels': 0,
                'total_pixels': total_pixels
            }
        else:
            all_ndvi_array = np.array(all_ndvi_values, dtype=np.float32)
            vegetation_coverage = (vegetation_pixels / valid_pixels) * 100.0 if valid_pixels > 0 else 0.0
            
            statistics = {
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
        
        return statistics, pixel_data
    
    def _extract_chunk_pixel_data(self, red_chunk: np.ndarray, nir_chunk: np.ndarray, 
                                 ndvi_chunk: np.ndarray, transform, chunk_row: int, 
                                 chunk_col: int, sampling_rate: int, src_crs: str) -> List[List[float]]:
        """
        PHASE 1: Extract pixel feature vectors from a chunk with spatial coordinates
        
        Args:
            red_chunk: Red band chunk
            nir_chunk: NIR band chunk  
            ndvi_chunk: NDVI chunk
            transform: Spatial transform for coordinate conversion
            chunk_row: Starting row of the chunk in the full image
            chunk_col: Starting column of the chunk in the full image
            sampling_rate: Take every Nth pixel
            src_crs: Source Coordinate Reference System of the image
            
        Returns:
            List of pixel feature vectors: [[ndvi, red, nir, lat, lng], ...]
        """
        
        chunk_pixels = []
        chunk_height, chunk_width = red_chunk.shape
        
        # Debug counters
        total_sampled = 0
        invalid_pixels = 0
        coord_errors = 0
        zero_value_pixels = 0
        masked_pixels = 0
        
        # Create a transformer for coordinate reprojection
        try:
            source_crs = CRS(src_crs)
            target_crs = CRS("EPSG:4326")  # WGS 84 (lat/lon)
            transformer = Transformer.from_crs(source_crs, target_crs, always_xy=True)
        except Exception as e:
            logger.error(f"❌ Failed to create coordinate transformer: {str(e)}")
            return [] # Cannot proceed without a transformer

        # Sample pixels from the chunk
        for r in range(0, chunk_height, sampling_rate):
            for c in range(0, chunk_width, sampling_rate):
                total_sampled += 1
                
                # Get pixel values
                red_val = red_chunk[r, c]
                nir_val = nir_chunk[r, c]
                ndvi_val = ndvi_chunk[r, c]
                
                # Skip no-data pixels (zero values in Sentinel-2 L2A indicate no data)
                if red_val <= 0 or nir_val <= 0:
                    invalid_pixels += 1
                    zero_value_pixels += 1
                    continue
                
                # Skip invalid pixels - handle masked arrays properly
                red_masked = (hasattr(red_val, 'mask') and red_val.mask) or np.isnan(red_val) or np.isinf(red_val)
                nir_masked = (hasattr(nir_val, 'mask') and nir_val.mask) or np.isnan(nir_val) or np.isinf(nir_val)
                ndvi_masked = (hasattr(ndvi_val, 'mask') and ndvi_val.mask) or np.isnan(ndvi_val) or np.isinf(ndvi_val)
                
                if red_masked or nir_masked or ndvi_masked:
                    invalid_pixels += 1
                    masked_pixels += 1
                    # Debug first invalid pixel
                    if invalid_pixels == 1 and chunk_row < 512 and chunk_col < 512:
                        logger.info(f"🔍 First invalid pixel debug: red_masked={red_masked}, nir_masked={nir_masked}, ndvi_masked={ndvi_masked}")
                        logger.info(f"    red_val={red_val}, nir_val={nir_val}, ndvi_val={ndvi_val}")
                        logger.info(f"    red_val type: {type(red_val)}, has mask: {hasattr(red_val, 'mask')}")
                        if hasattr(red_val, 'mask'):
                            logger.info(f"    red_val.mask: {red_val.mask}")
                    continue
                
                # Calculate absolute pixel coordinates
                abs_row = chunk_row + r
                abs_col = chunk_col + c
                
                # Convert pixel coordinates to geographic coordinates (lat, lng)
                try:
                    # rasterio.transform.xy expects (rows, cols)
                    x, y = xy(transform, abs_row, abs_col)

                    # Reproject coordinates from source CRS to WGS 84
                    lng, lat = transformer.transform(x, y)
                    
                    # Validate coordinates are reasonable
                    if not (-180 <= lng <= 180 and -90 <= lat <= 90):
                        coord_errors += 1
                        continue
                        
                    # Create pixel feature vector: [ndvi, red, nir, lat, lng]
                    pixel_features = [
                        float(ndvi_val),
                        float(red_val),
                        float(nir_val),
                        float(lat),
                        float(lng)
                    ]
                    
                    chunk_pixels.append(pixel_features)
                    
                except Exception as e:
                    # Skip pixels with coordinate conversion errors
                    coord_errors += 1
                    continue
        
        # Only log if we found valid pixels or if this is one of the first few chunks
        if len(chunk_pixels) > 0:
            logger.info(f"✅ Chunk [{chunk_row}:{chunk_col}] SUCCESS: {len(chunk_pixels)} pixels extracted!")
        elif chunk_row < 1024 and chunk_col < 1024:  # Only log failures for first few chunks
            logger.info(f"❌ Chunk [{chunk_row}:{chunk_col}] sampled {total_sampled} -> 0 extracted")
            logger.info(f"    Zero values: {zero_value_pixels}, Masked: {masked_pixels}, Coord errors: {coord_errors}")
        
        return chunk_pixels
    
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
        
        # Identify no-data areas (both bands are zero or very low)
        no_data_mask = (red <= 1) & (nir <= 1)  # Both bands essentially zero
        
        # Avoid division by zero
        with np.errstate(divide='ignore', invalid='ignore'):
            ndvi = np.divide(numerator, denominator, 
                           out=np.full_like(numerator, np.nan), 
                           where=(denominator != 0))
        
        # Mask invalid values including no-data areas
        ndvi_masked = np.ma.masked_where(
            no_data_mask | (denominator == 0) | (ndvi < -1) | (ndvi > 1), 
            ndvi
        )
        
        return ndvi_masked 