import json
import logging
import boto3
import numpy as np
from datetime import datetime
from typing import Dict, Any, List, Tuple
import time
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
sagemaker_client = boto3.client('sagemaker')
s3_client = boto3.client('s3')

# Environment variables
SAGEMAKER_ROLE_ARN = os.environ.get('SAGEMAKER_ROLE_ARN')
DATA_BUCKET = os.environ.get('PROCESSED_DATA_BUCKET', 'forestshield-processed-data-381492060635')

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    PHASE 2.2: Dynamic K Selection for K-means Clustering
    
    Runs multiple SageMaker training jobs with different K values in parallel
    and selects the optimal K based on cluster quality metrics.
    
    Expected event structure:
    {
        "mode": "select-optimal-k",
        "tile_id": "S2B",
        "training_data_path": "s3://bucket/path/to/training_data.csv",
        "image_id": "S2B_MSIL2A_20220601T...",
        "region": {"latitude": -6.0, "longitude": -53.0}
    }
    """
    
    try:
        logger.info("🎯 PHASE 2.2: Starting dynamic K selection")
        logger.info(f"📥 Input event: {json.dumps(event)}")
        
        mode = event.get('mode', 'select-optimal-k')
        
        if mode == 'select-optimal-k':
            return select_optimal_k(event, context)
        else:
            raise ValueError(f"Invalid mode: '{mode}'. Expected 'select-optimal-k'.")
            
    except Exception as e:
        logger.error(f"❌ K selection failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e),
                'optimal_k': 4  # Fallback to default
            }),
            'optimal_k': 4  # For Step Functions access
        }

def select_optimal_k(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Select optimal K value by running multiple SageMaker training jobs
    """
    
    # Extract parameters
    tile_id = event.get('tile_id', 'unknown')
    training_data_path = event['training_data_path']
    image_id = event.get('image_id', 'unknown')
    region = event.get('region', {})
    
    # K values to test - focusing on practical range for vegetation clustering
    k_values = [2, 3, 4, 5, 6]  # Start conservative to avoid costs
    
    logger.info(f"🧮 Testing K values: {k_values} for tile {tile_id}")
    
    # Start multiple SageMaker training jobs in parallel
    training_jobs = []
    timestamp = str(int(datetime.now().timestamp()))
    
    for k in k_values:
        job_name = f"k-selection-{tile_id}-k{k}-{timestamp}"
        
        try:
            job_arn = start_k_selection_training_job(
                job_name=job_name,
                k_value=k,
                training_data_path=training_data_path,
                tile_id=tile_id,
                image_id=image_id
            )
            
            training_jobs.append({
                'k': k,
                'job_name': job_name,
                'job_arn': job_arn,
                'status': 'InProgress'
            })
            
            logger.info(f"✅ Started K={k} training job: {job_name}")
            
        except Exception as e:
            logger.error(f"❌ Failed to start K={k} training job: {str(e)}")
            training_jobs.append({
                'k': k,
                'job_name': job_name,
                'job_arn': None,
                'status': 'Failed',
                'error': str(e)
            })
    
    # Wait for all jobs to complete and evaluate results
    logger.info("⏳ Waiting for all K-selection training jobs to complete...")
    
    max_wait_time = 1800  # 30 minutes max wait
    start_time = time.time()
    completed_jobs = []
    
    while len(completed_jobs) < len([job for job in training_jobs if job['status'] != 'Failed']) and (time.time() - start_time) < max_wait_time:
        for job in training_jobs:
            if job['status'] == 'InProgress' and job['job_arn']:
                try:
                    response = sagemaker_client.describe_training_job(
                        TrainingJobName=job['job_name']
                    )
                    
                    job_status = response['TrainingJobStatus']
                    
                    if job_status in ['Completed', 'Failed', 'Stopped']:
                        job['status'] = job_status
                        job['response'] = response
                        
                        if job_status == 'Completed':
                            # Get final metrics
                            job['metrics'] = extract_training_metrics(response)
                            completed_jobs.append(job)
                            logger.info(f"✅ K={job['k']} training completed with metrics: {job['metrics']}")
                        else:
                            logger.error(f"❌ K={job['k']} training failed: {job_status}")
                            
                except Exception as e:
                    logger.error(f"❌ Error checking job {job['job_name']}: {str(e)}")
        
        # Sleep before next check
        if len(completed_jobs) < len([job for job in training_jobs if job['status'] != 'Failed']):
            time.sleep(10)
    
    # Select optimal K based on metrics
    if not completed_jobs:
        logger.warning("⚠️ No training jobs completed successfully, using default K=4")
        optimal_k = 4
        selection_reason = "Default - no successful training jobs"
        confidence_score = 0.5
    else:
        optimal_k, selection_reason, confidence_score = analyze_k_selection_results(completed_jobs)
    
    logger.info(f"🎯 Selected optimal K={optimal_k}: {selection_reason} (confidence: {confidence_score:.2f})")
    
    # Clean up incomplete jobs (optional cost optimization)
    cleanup_incomplete_jobs(training_jobs)
    
    return {
        'statusCode': 200,
        'body': json.dumps({
            'status': 'success',
            'optimal_k': optimal_k,
            'selection_reason': selection_reason,
            'confidence_score': confidence_score,
            'tested_k_values': k_values,
            'completed_jobs': len(completed_jobs),
            'total_jobs': len(training_jobs),
            'tile_id': tile_id,
            'processing_time_seconds': int(time.time() - start_time)
        }),
        'optimal_k': optimal_k,  # For Step Functions access
        'confidence_score': confidence_score,
        'selection_metadata': {
            'tested_k_values': k_values,
            'completed_jobs': len(completed_jobs),
            'selection_reason': selection_reason,
            'tile_id': tile_id
        }
    }

def start_k_selection_training_job(job_name: str, k_value: int, training_data_path: str, tile_id: str, image_id: str) -> str:
    """
    Start a SageMaker training job for a specific K value
    """
    
    if not SAGEMAKER_ROLE_ARN:
        raise ValueError("SAGEMAKER_ROLE_ARN environment variable not set")
    
    # Training image for K-means
    training_image = "174872318107.dkr.ecr.us-west-2.amazonaws.com/kmeans:1"
    
    # Input data configuration
    input_config = [{
        'ChannelName': 'training',
        'DataSource': {
            'S3DataSource': {
                'S3DataType': 'S3Prefix',
                'S3Uri': training_data_path,
                'S3DataDistributionType': 'FullyReplicated'
            }
        },
        'ContentType': 'text/csv',
        'CompressionType': 'None'
    }]
    
    # Output configuration
    output_config = {
        'S3OutputPath': f's3://{DATA_BUCKET}/k-selection-output/{tile_id}/'
    }
    
    # Resource configuration - smaller instances for K selection
    resource_config = {
        'InstanceType': 'ml.m5.large',
        'InstanceCount': 1,
        'VolumeSizeInGB': 10
    }
    
    # Hyperparameters
    hyperparameters = {
        'k': str(k_value),
        'feature_dim': '5',  # NDVI, Red, NIR, Lat, Lng
        'mini_batch_size': '1000',
        'epochs': '10',
        'init_method': 'kmeans++',
        'local_init_method': 'kmeans++',
        'half_life_time_size': '0',
        'epochs_between_reporting': '1'
    }
    
    # Create training job
    response = sagemaker_client.create_training_job(
        TrainingJobName=job_name,
        AlgorithmSpecification={
            'TrainingImage': training_image,
            'TrainingInputMode': 'File'
        },
        RoleArn=SAGEMAKER_ROLE_ARN,
        InputDataConfig=input_config,
        OutputDataConfig=output_config,
        ResourceConfig=resource_config,
        StoppingCondition={
            'MaxRuntimeInSeconds': 1800  # 30 minutes max per job
        },
        HyperParameters=hyperparameters,
        Tags=[
            {'Key': 'Project', 'Value': 'ForestShield'},
            {'Key': 'Component', 'Value': 'KSelection'},
            {'Key': 'TileId', 'Value': tile_id},
            {'Key': 'ImageId', 'Value': image_id},
            {'Key': 'KValue', 'Value': str(k_value)}
        ]
    )
    
    return response['TrainingJobArn']

def extract_training_metrics(training_response: Dict[str, Any]) -> Dict[str, float]:
    """
    Extract relevant metrics from SageMaker training job response
    """
    
    metrics = {}
    
    # Get final metrics from training job
    final_metrics = training_response.get('FinalMetricDataList', [])
    
    for metric in final_metrics:
        metric_name = metric['MetricName']
        metric_value = metric['Value']
        metrics[metric_name] = metric_value
    
    # Add training time as a factor
    if 'TrainingStartTime' in training_response and 'TrainingEndTime' in training_response:
        training_duration = (training_response['TrainingEndTime'] - training_response['TrainingStartTime']).total_seconds()
        metrics['training_duration_seconds'] = training_duration
    
    return metrics

def analyze_k_selection_results(completed_jobs: List[Dict[str, Any]]) -> Tuple[int, str, float]:
    """
    Analyze K selection results and choose optimal K
    """
    
    if not completed_jobs:
        return 4, "Default - no completed jobs", 0.5
    
    # Analyze metrics for each K value
    k_analysis = []
    
    for job in completed_jobs:
        k = job['k']
        metrics = job.get('metrics', {})
        
        # Primary metric: minimize within-cluster sum of squares (if available)
        wcss = metrics.get('msd', metrics.get('objective_loss', float('inf')))
        training_time = metrics.get('training_duration_seconds', 0)
        
        # Calculate score (lower WCSS is better, but penalize complexity)
        # Add small penalty for higher K values to prevent overfitting
        complexity_penalty = k * 0.1
        score = wcss + complexity_penalty
        
        k_analysis.append({
            'k': k,
            'wcss': wcss,
            'score': score,
            'training_time': training_time,
            'metrics': metrics
        })
        
        logger.info(f"📊 K={k}: WCSS={wcss:.4f}, Score={score:.4f}, Time={training_time:.1f}s")
    
    # Sort by score (lower is better)
    k_analysis.sort(key=lambda x: x['score'])
    
    # Check for elbow method - look for point where improvement diminishes
    if len(k_analysis) >= 3:
        # Calculate improvement rates
        improvements = []
        for i in range(1, len(k_analysis)):
            prev_score = k_analysis[i-1]['score']
            curr_score = k_analysis[i]['score']
            improvement = prev_score - curr_score  # Positive means improvement
            improvements.append(improvement)
        
        # Find elbow - where improvement rate drops significantly
        max_improvement = max(improvements) if improvements else 0
        elbow_threshold = max_improvement * 0.3  # 30% of max improvement
        
        for i, improvement in enumerate(improvements):
            if improvement < elbow_threshold:
                # Found elbow point
                optimal_k = k_analysis[i]['k']
                selection_reason = f"Elbow method - diminishing returns after K={optimal_k}"
                confidence_score = 0.8
                return optimal_k, selection_reason, confidence_score
    
    # Fallback: choose K with best score
    best_result = k_analysis[0]
    optimal_k = best_result['k']
    selection_reason = f"Best WCSS score: {best_result['wcss']:.4f}"
    
    # Confidence based on score separation
    if len(k_analysis) > 1:
        best_score = k_analysis[0]['score']
        second_best_score = k_analysis[1]['score']
        score_gap = second_best_score - best_score
        confidence_score = min(0.9, 0.5 + score_gap * 2)  # Higher gap = higher confidence
    else:
        confidence_score = 0.6
    
    return optimal_k, selection_reason, confidence_score

def cleanup_incomplete_jobs(training_jobs: List[Dict[str, Any]]) -> None:
    """
    Clean up any training jobs that are still running (cost optimization)
    """
    
    for job in training_jobs:
        if job['status'] == 'InProgress' and job['job_arn']:
            try:
                logger.info(f"🧹 Stopping incomplete training job: {job['job_name']}")
                sagemaker_client.stop_training_job(TrainingJobName=job['job_name'])
            except Exception as e:
                logger.warning(f"⚠️ Could not stop job {job['job_name']}: {str(e)}") 