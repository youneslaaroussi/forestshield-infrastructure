import boto3
import os
import json
import logging
from datetime import datetime
from statistics import mean, stdev
import tarfile
from io import BytesIO
import joblib
import numpy as np

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3 = boto3.client('s3')
sagemaker = boto3.client('sagemaker')

# Environment variables
PROCESSED_DATA_BUCKET = os.environ.get('PROCESSED_DATA_BUCKET')
MODEL_STORAGE_PREFIX = "sagemaker-models"

def lambda_handler(event, context):
    """
    Manages SageMaker models for ForestShield.
    Modes of operation:
    1. get-latest-model: Checks for the latest existing model for a region (tile_id).
    2. save-new-model: Saves a newly trained model to the structured S3 path.
    3. compare-models: Compares current and historical models for change detection.
    4. get-model-history: Gets all historical models for a region.
    5. track-model-performance: Tracks model performance over time.
    """
    mode = event.get('mode')
    
    if not PROCESSED_DATA_BUCKET:
        raise ValueError("PROCESSED_DATA_BUCKET environment variable is not set.")

    logger.info(f"🚀 Starting model-manager in '{mode}' mode.")
    
    if mode == 'get-latest-model':
        return get_latest_model(event)
    elif mode == 'save-new-model':
        return save_new_model(event)
    elif mode == 'compare-models':
        return compare_models(event)
    elif mode == 'get-model-history':
        return get_model_history(event)
    elif mode == 'track-model-performance':
        return track_model_performance(event)
    else:
        raise ValueError(f"Invalid mode: '{mode}'. Must be 'get-latest-model', 'save-new-model', 'compare-models', 'get-model-history', or 'track-model-performance'.")

def get_latest_model(event):
    """
    Finds the latest version of a model for a given tile_id and region in S3.
    """
    tile_id = event.get('tile_id')
    region = event.get('region')
    if not tile_id or not region:
        raise ValueError("Missing 'tile_id' or 'region' for get-latest-model mode.")
        
    logger.info(f"🔍 Searching for latest model for tile: {tile_id} in region: {region}")
    
    prefix = f"{MODEL_STORAGE_PREFIX}/{region}/{tile_id}/"
    
    try:
        response = s3.list_objects_v2(Bucket=PROCESSED_DATA_BUCKET, Prefix=prefix, Delimiter='/')
        
        # Get all subdirectories (which are timestamps)
        if 'CommonPrefixes' not in response:
            logger.info(f"✅ No existing models found for tile: {tile_id} in region: {region}. A new model will be trained.")
            return {"model_exists": False}
            
        # Sort timestamps to find the most recent
        timestamps = sorted([p['Prefix'] for p in response['CommonPrefixes']], reverse=True)
        latest_version_prefix = timestamps[0]
        
        metadata_path = f"{latest_version_prefix}metadata.json"
        
        logger.info(f"📄 Found latest model version. Fetching metadata from: {metadata_path}")
        
        metadata_obj = s3.get_object(Bucket=PROCESSED_DATA_BUCKET, Key=metadata_path)
        metadata = json.loads(metadata_obj['Body'].read().decode('utf-8'))
        
        return {
            "model_exists": True,
            "model_s3_path": metadata['model_s3_path'],
            "metadata": metadata
        }
        
    except Exception as e:
        logger.error(f"❌ Error getting latest model for {tile_id} in region {region}: {e}")
        # If any error occurs, assume no model exists to allow training to proceed
        return {"model_exists": False}

def save_new_model(event):
    """
    Saves a new model from a SageMaker training job to our organized S3 path.
    """
    training_job_name = event.get('training_job_name')
    tile_id = event.get('tile_id')
    region = event.get('region')
    source_image_id = event.get('source_image_id')
    training_data_path = event.get('training_data_path')
    
    if not all([training_job_name, tile_id, region, source_image_id, training_data_path]):
        raise ValueError("Missing one or more required fields for save-new-model mode.")

    logger.info(f"💾 Saving new model from training job: {training_job_name} for region {region}")

    try:
        # 1. Get the original model artifact path from SageMaker
        job_details = sagemaker.describe_training_job(TrainingJobName=training_job_name)
        original_model_path = job_details['ModelArtifacts']['S3ModelArtifacts']
        hyperparameters = job_details.get('HyperParameters', {})

        # 2. Define the new structured path
        timestamp = datetime.utcnow()
        version_str = timestamp.strftime('%Y%m%d-%H%M%S')
        new_prefix = f"{MODEL_STORAGE_PREFIX}/{region}/{tile_id}/{version_str}/"
        new_model_key = f"{new_prefix}model.tar.gz"
        
        source_bucket, source_key = original_model_path.replace("s3://", "").split("/", 1)

        # 3. Copy the model.tar.gz to the new destination
        logger.info(f"Copying model from {original_model_path} to s3://{PROCESSED_DATA_BUCKET}/{new_model_key}")
        s3.copy_object(
            Bucket=PROCESSED_DATA_BUCKET,
            CopySource={'Bucket': source_bucket, 'Key': source_key},
            Key=new_model_key
        )
        
        # 4. Create and upload metadata.json
        metadata = {
            "tile_id": tile_id,
            "region": region,
            "model_version": version_str,
            "model_s3_path": f"s3://{PROCESSED_DATA_BUCKET}/{new_model_key}",
            "training_data_s3_path": training_data_path,
            "source_image_id": source_image_id,
            "source_training_job": training_job_name,
            "creation_timestamp_utc": timestamp.isoformat() + "Z",
            "hyperparameters": hyperparameters,
            "performance_metrics": {
                # Placeholder for future metrics like silhouette score
                "silhouette_score": None 
            }
        }
        
        metadata_key = f"{new_prefix}metadata.json"
        s3.put_object(
            Bucket=PROCESSED_DATA_BUCKET,
            Key=metadata_key,
            Body=json.dumps(metadata, indent=2),
            ContentType='application/json'
        )
        logger.info(f"📄 Metadata saved to s3://{PROCESSED_DATA_BUCKET}/{metadata_key}")

        return {
            "status": "success",
            "new_model_path": metadata['model_s3_path'],
            "metadata_path": f"s3://{PROCESSED_DATA_BUCKET}/{metadata_key}"
        }

    except Exception as e:
        logger.error(f"❌ Error saving new model for job {training_job_name}: {e}")
        raise

def get_model_history(event):
    """
    Gets all historical models for a given tile_id and region, sorted by creation date.
    """
    tile_id = event.get('tile_id')
    region = event.get('region')
    if not tile_id or not region:
        raise ValueError("Missing 'tile_id' or 'region' for get-model-history mode.")
        
    logger.info(f"📚 Getting model history for tile: {tile_id} in region: {region}")
    
    prefix = f"{MODEL_STORAGE_PREFIX}/{region}/{tile_id}/"
    
    try:
        response = s3.list_objects_v2(Bucket=PROCESSED_DATA_BUCKET, Prefix=prefix, Delimiter='/')
        
        if 'CommonPrefixes' not in response:
            logger.info(f"✅ No historical models found for tile: {tile_id} in region: {region}")
            return {"models": []}
            
        # Get all model versions sorted by timestamp (newest first)
        timestamps = sorted([p['Prefix'] for p in response['CommonPrefixes']], reverse=True)
        
        models = []
        for version_prefix in timestamps:
            metadata_path = f"{version_prefix}metadata.json"
            
            try:
                metadata_obj = s3.get_object(Bucket=PROCESSED_DATA_BUCKET, Key=metadata_path)
                metadata = json.loads(metadata_obj['Body'].read().decode('utf-8'))
                models.append(metadata)
            except Exception as e:
                logger.warning(f"⚠️ Could not load metadata for {version_prefix}: {e}")
                continue
        
        logger.info(f"📚 Found {len(models)} historical models for tile: {tile_id} in region: {region}")
        return {"models": models}
        
    except Exception as e:
        logger.error(f"❌ Error getting model history for {tile_id} in region {region}: {e}")
        raise

def _load_model_from_s3(model_s3_path):
    """Downloads, extracts, and loads a scikit-learn model from S3."""
    try:
        bucket_name, key = model_s3_path.replace("s3://", "").split("/", 1)
        logger.info(f"Loading model from s3://{bucket_name}/{key}")
        
        response = s3.get_object(Bucket=bucket_name, Key=key)
        model_data = response['Body'].read()
        
        # Use BytesIO to treat the byte stream as a file
        with BytesIO(model_data) as bio:
            # Open the tar.gz file
            with tarfile.open(fileobj=bio, mode="r:gz") as tar:
                # Find the model file inside the archive (assuming it's model.joblib or similar)
                model_file_name = next((m.name for m in tar.getmembers() if m.isfile() and 'model' in m.name), None)
                if not model_file_name:
                    raise FileNotFoundError("Could not find a model file in the archive.")
                
                # Extract the model file into a BytesIO object
                model_file_obj = tar.extractfile(model_file_name)
                if model_file_obj:
                    with BytesIO(model_file_obj.read()) as model_bio:
                        model = joblib.load(model_bio)
                        logger.info(f"✅ Model {model_file_name} loaded successfully.")
                        return model
                else:
                    raise FileNotFoundError("Could not extract model file object.")

    except Exception as e:
        logger.error(f"❌ Failed to load model from {model_s3_path}: {e}")
        raise

def compare_models(event):
    """
    Orchestrates the comparison of two models by loading them and their data,
    then calling the change detection logic.
    """
    tile_id = event.get('tile_id')
    region = event.get('region')
    current_model_path = event.get('current_model_path')
    historical_model_path = event.get('historical_model_path')
    pixel_data_path = event.get('pixel_data_path')
    
    if not all([tile_id, region, current_model_path, historical_model_path, pixel_data_path]):
        raise ValueError("Missing required parameters for compare-models mode.")
    
    logger.info(f"Performing change detection for tile: {tile_id}")
    
    try:
        pixel_statistics = load_pixel_statistics(pixel_data_path)
        if not pixel_statistics.get("data_available"):
            raise ValueError("Pixel data could not be loaded.")

        change_metrics = detect_vegetation_changes(
            current_model_path, historical_model_path, pixel_statistics, tile_id
        )
        
        logger.info(f"✅ Change detection completed for {tile_id}")
        
        return {
            "status": "completed",
            "message": "Cluster-based change detection completed",
            "tile_id": tile_id,
            "region": region,
            "change_detection": change_metrics
        }
        
    except Exception as e:
        logger.error(f"Change detection failed for {tile_id}: {str(e)}")
        return { "status": "failed", "error": str(e) }

def _classify_cluster_centroids(model):
    """
    Classifies cluster centroids based on their average NDVI value.
    Returns a mapping from cluster index to a semantic label.
    """
    centroids = model.cluster_centers_
    # The first feature is NDVI. Create a list of (cluster_index, ndvi_value).
    ndvi_values = [(i, centroid[0]) for i, centroid in enumerate(centroids)]
    
    # Sort clusters by NDVI value in descending order (highest NDVI first)
    sorted_clusters = sorted(ndvi_values, key=lambda item: item[1], reverse=True)
    
    classifications = {}
    if not sorted_clusters:
        return {}
    
    # Handle single-cluster case
    if len(sorted_clusters) == 1:
        if sorted_clusters[0][1] > 0.6:
            classifications[sorted_clusters[0][0]] = 'dense_forest'
        elif sorted_clusters[0][1] < 0.3:
            classifications[sorted_clusters[0][0]] = 'deforested'
        else:
            classifications[sorted_clusters[0][0]] = 'degraded_vegetation'
        return classifications

    # Assign 'dense_forest' to the cluster with the highest NDVI
    classifications[sorted_clusters[0][0]] = 'dense_forest'
    
    # Assign 'deforested' to the cluster with the lowest NDVI
    classifications[sorted_clusters[-1][0]] = 'deforested'
    
    # Assign 'degraded_vegetation' to all other clusters in between
    for i in range(1, len(sorted_clusters) - 1):
        classifications[sorted_clusters[i][0]] = 'degraded_vegetation'
        
    logger.info(f"Centroid classifications: {classifications}")
    return classifications

def detect_vegetation_changes(current_model_path, historical_model_path, pixel_statistics, tile_id):
    """
    Performs a genuine change detection by classifying clusters based on NDVI centroids
    and comparing their assignments for each pixel.
    """
    
    # 1. Load the actual model objects from S3
    current_model = _load_model_from_s3(current_model_path)
    historical_model = _load_model_from_s3(historical_model_path)

    # 2. Classify centroids for both models to understand what each cluster means
    current_class_map = _classify_cluster_centroids(current_model)
    historical_class_map = _classify_cluster_centroids(historical_model)
    
    # 3. Get the pixel data to run predictions on, converting to a NumPy array
    pixels_to_predict = np.array([p[:3] for p in pixel_statistics["pixels"]])
    
    if not pixels_to_predict.any():
        logger.warning("No pixels available to predict for change detection.")
        return {"pixels_changed_clusters": 0, "analysis_method": "change_detection_no_data"}

    # 4. Run predictions with both models
    current_labels = current_model.predict(pixels_to_predict)
    historical_labels = historical_model.predict(pixels_to_predict)
    
    # 5. Tally the changes based on semantic classification
    transitions = {
        "forest_to_degraded": 0, "forest_to_deforested": 0, "degraded_to_deforested": 0,
        "degraded_to_forest": 0, "deforested_to_degraded": 0, "deforested_to_forest": 0,
    }
    changed_pixels = 0

    for i in range(len(current_labels)):
        hist_class = historical_class_map.get(historical_labels[i])
        curr_class = current_class_map.get(current_labels[i])

        if hist_class != curr_class:
            changed_pixels += 1
            transition_key = f"{hist_class}_to_{curr_class}"
            if transition_key in transitions:
                transitions[transition_key] += 1

    total_pixels = len(current_labels)
    change_percentage = (changed_pixels / total_pixels) * 100 if total_pixels > 0 else 0
    
    logger.info(f"🔎 Change Detection Complete. {changed_pixels}/{total_pixels} pixels changed semantic class ({change_percentage:.2f}%).")
    logger.info(f"   Transitions: {transitions}")
    
    return {
        "pixels_changed_clusters": changed_pixels,
        "change_percentage": change_percentage,
        "forest_to_degraded": transitions['forest_to_degraded'],
        "degraded_to_deforested": transitions['degraded_to_deforested'],
        "forest_to_deforested": transitions['forest_to_deforested'],
        "new_growth_pixels": transitions['degraded_to_forest'] + transitions['deforested_to_degraded'] + transitions['deforested_to_forest'],
        "confidence_score": min(change_percentage / 10, 1.0),
        "analysis_method": "change_detection_with_centroid_classification"
    }

def load_pixel_statistics(pixel_data_path):
    """Load pixel data from S3 and calculate basic statistics."""
    try:
        bucket_name = pixel_data_path.split('/')[2]
        key = '/'.join(pixel_data_path.split('/')[3:])
        
        logger.info(f"Downloading pixel data from s3://{bucket_name}/{key}")
        
        response = s3.get_object(Bucket=bucket_name, Key=key)
        pixel_data = json.loads(response['Body'].read().decode('utf-8'))
        
        if not pixel_data or 'pixels' not in pixel_data:
            logger.warning("Pixel data is empty or does not contain a 'pixels' key.")
            return {"data_available": False, "pixel_count": 0}
            
        pixels = pixel_data['pixels']
        pixel_count = len(pixels)
        
        if pixel_count == 0:
            return {"data_available": True, "pixel_count": 0, "pixels": []}

        # Extract coordinates to calculate bounding box
        longitudes = [p[4] for p in pixels]
        latitudes = [p[3] for p in pixels]

        stats = {
            "data_available": True,
            "pixel_count": pixel_count,
            "bounding_box": {
                "min_lat": min(latitudes),
                "max_lat": max(latitudes),
                "min_lon": min(longitudes),
                "max_lon": max(longitudes),
            },
            "pixels": pixels # Return the pixel data for further processing
        }
        logger.info(f"Successfully loaded {pixel_count} pixels.")
        return stats
        
    except Exception as e:
        logger.error(f"❌ Could not load pixel data from {pixel_data_path}: {str(e)}")
        return {"data_available": False, "pixel_count": 0}

def track_model_performance(event):
    """
    Tracks model performance metrics over time for a specific tile and region.
    This can be used to monitor for concept drift or performance degradation.
    """
    tile_id = event.get('tile_id')
    region = event.get('region')
    if not tile_id or not region:
        raise ValueError("Missing 'tile_id' or 'region' for track-model-performance mode.")

    logger.info(f"📈 Tracking performance for tile: {tile_id} in region: {region}")

    try:
        # Fetch all historical models for the tile and region
        history_event = {'tile_id': tile_id, 'region': region}
        model_history_response = get_model_history(history_event)
        
        if not model_history_response or not model_history_response.get('models'):
            logger.info(f"No model history found for tile {tile_id}, region {region}. Cannot track performance.")
            return {
                "status": "no_history",
                "message": "No historical models available to track performance."
            }
        
        # Load existing performance history
        performance_history_key = f"model-performance/{tile_id}/performance_history.json"
        
        try:
            performance_history = load_json_from_s3(PROCESSED_DATA_BUCKET, performance_history_key)
        except:
            # Initialize new performance history
            performance_history = {
                'tile_id': tile_id,
                'region': region,
                'tracking_started': datetime.utcnow().isoformat() + 'Z',
                'performance_entries': [],
                'summary_stats': {
                    'total_analyses': 0,
                    'avg_cluster_stability': 0.0,
                    'avg_change_detection_confidence': 0.0,
                    'model_reuse_rate': 0.0
                }
            }
        
        # Create new performance entry
        performance_entry = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'model_path': model_history_response['models'][-1]['model_s3_path'],
            'training_job_name': model_history_response['models'][-1]['source_training_job'],
            'image_id': model_history_response['models'][-1]['source_image_id'],
            'cluster_stability': calculate_cluster_stability_score(model_history_response['models'][-1]),
            'spatial_coherence': model_history_response['models'][-1]['performance_metrics'].get('spatial_coherence_confidence', 0.0),
            'data_quality': model_history_response['models'][-1]['performance_metrics'].get('data_quality_confidence', 0.0),
            'historical_consistency': model_history_response['models'][-1]['performance_metrics'].get('historical_consistency_confidence', 0.0),
            'overall_confidence': model_history_response['models'][-1]['confidence_score'],
            'processing_time_ms': model_history_response['models'][-1]['performance_metrics'].get('processing_time_ms', 0),
            'pixels_analyzed': model_history_response['models'][-1]['pixels_analyzed'],
            'model_reused': False
        }
        
        # Add to history
        performance_history['performance_entries'].append(performance_entry)
        
        # Update summary statistics
        entries = performance_history['performance_entries']
        total_entries = len(entries)
        
        performance_history['summary_stats'] = {
            'total_analyses': total_entries,
            'avg_cluster_stability': mean([e['cluster_stability'] for e in entries]),
            'avg_spatial_coherence': mean([e['spatial_coherence'] for e in entries]),
            'avg_data_quality': mean([e['data_quality'] for e in entries]),
            'avg_overall_confidence': mean([e['overall_confidence'] for e in entries]),
            'model_reuse_rate': sum(1 for e in entries if e['model_reused']) / total_entries if total_entries > 0 else 0,
            'last_updated': datetime.utcnow().isoformat() + 'Z',
            'performance_trend': calculate_performance_trend(entries)
        }
        
        # Detect performance anomalies
        anomalies = detect_performance_anomalies(entries)
        if anomalies:
            performance_history['recent_anomalies'] = anomalies
        
        # Save updated performance history
        save_json_to_s3(PROCESSED_DATA_BUCKET, performance_history_key, performance_history)
        
        logger.info(f"📊 Performance tracking updated for {tile_id} in region {region}")
        logger.info(f"   Total analyses: {total_entries}")
        logger.info(f"   Avg confidence: {performance_history['summary_stats']['avg_overall_confidence']:.2f}")
        logger.info(f"   Model reuse rate: {performance_history['summary_stats']['model_reuse_rate']:.1%}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'status': 'success',
                'tile_id': tile_id,
                'region': region,
                'performance_summary': performance_history['summary_stats'],
                'anomalies_detected': len(anomalies) if anomalies else 0,
                'tracking_entries': total_entries
            })
        }
        
    except Exception as e:
        logger.error(f"❌ Performance tracking failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e)
            })
        }

def calculate_cluster_stability_score(model_metadata):
    """
    Calculate a cluster stability score based on model metadata
    """
    
    # For now, use hyperparameters and training metrics as stability indicators
    stability_score = 0.8  # Default reasonable stability
    
    # Adjust based on available metadata
    if 'hyperparameters' in model_metadata:
        k_value = int(model_metadata['hyperparameters'].get('k', 4))
        # More clusters might indicate less stability (more complexity)
        if k_value <= 4:
            stability_score += 0.1
        elif k_value >= 6:
            stability_score -= 0.1
    
    # Adjust based on training data size
    pixels_analyzed = model_metadata.get('pixels_analyzed', 0)
    if pixels_analyzed > 10000:
        stability_score += 0.1  # More data usually means more stable clusters
    elif pixels_analyzed < 5000:
        stability_score -= 0.1
    
    return max(0.0, min(1.0, stability_score))

def calculate_performance_trend(entries):
    """
    Calculate performance trend over recent entries
    """
    
    if len(entries) < 3:
        return "insufficient_data"
    
    # Look at last 5 entries for trend
    recent_entries = entries[-5:]
    recent_confidences = [e['overall_confidence'] for e in recent_entries]
    
    # Simple trend analysis
    if len(recent_confidences) >= 3:
        first_half = mean(recent_confidences[:len(recent_confidences)//2])
        second_half = mean(recent_confidences[len(recent_confidences)//2:])
        
        if second_half > first_half + 0.05:
            return "improving"
        elif second_half < first_half - 0.05:
            return "declining" 
        else:
            return "stable"
    
    return "stable"

def detect_performance_anomalies(entries):
    """
    Detect performance anomalies in recent entries
    """
    
    anomalies = []
    
    if len(entries) < 5:
        return anomalies
    
    # Get recent entries for comparison
    recent_entries = entries[-10:]  # Last 10 entries
    confidences = [e['overall_confidence'] for e in recent_entries]
    processing_times = [e['processing_time_ms'] for e in recent_entries if e['processing_time_ms'] > 0]
    
    # Check for confidence anomalies
    if len(confidences) >= 5:
        confidence_mean = mean(confidences[:-1])  # Exclude most recent
        confidence_std = stdev(confidences[:-1]) if len(confidences) > 2 else 0.1
        latest_confidence = confidences[-1]
        
        # Anomaly if latest is more than 2 standard deviations away
        if abs(latest_confidence - confidence_mean) > 2 * confidence_std:
            anomalies.append({
                'type': 'confidence_anomaly',
                'description': f'Confidence {latest_confidence:.2f} deviates significantly from recent average {confidence_mean:.2f}',
                'severity': 'high' if abs(latest_confidence - confidence_mean) > 3 * confidence_std else 'medium',
                'detected_at': datetime.utcnow().isoformat() + 'Z'
            })
    
    # Check for processing time anomalies
    if len(processing_times) >= 5:
        time_mean = mean(processing_times[:-1])
        time_std = stdev(processing_times[:-1]) if len(processing_times) > 2 else time_mean * 0.2
        latest_time = processing_times[-1]
        
        # Anomaly if processing time is unusually high
        if latest_time > time_mean + 2 * time_std and latest_time > 10000:  # > 10 seconds
            anomalies.append({
                'type': 'processing_time_anomaly',
                'description': f'Processing time {latest_time}ms significantly higher than average {time_mean:.0f}ms',
                'severity': 'medium',
                'detected_at': datetime.utcnow().isoformat() + 'Z'
            })
    
    return anomalies
