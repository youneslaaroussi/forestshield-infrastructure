import json
import logging
import time
import os
import boto3
import base64
from typing import Dict, Any, List
from statistics import mean, stdev
from datetime import datetime
from io import BytesIO

# PDF generation imports
from reportlab.lib.pagesizes import letter, A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib import colors
from reportlab.platypus.tableofcontents import TableOfContents

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Environment variables
API_BASE_URL = os.environ.get('FORESTSHIELD_API_BASE_URL', 'http://localhost:3000')
PROCESSED_DATA_BUCKET = os.environ.get('PROCESSED_DATA_BUCKET', 'forestshield-processed-data')

# Initialize AWS clients
lambda_client = boto3.client('lambda')

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for consolidating NDVI analysis results and generating alert emails
    
    Takes an array of processing results from the Step Functions Map state and:
    1. Calculates aggregate statistics 
    2. Determines risk level based on vegetation analysis
    3. Generates professional email content for SNS
    
    Args:
        event: Array of processing results from vegetation-analyzer
        context: Lambda context object
        
    Returns:
        Consolidated analysis with email content and risk assessment
    """
    
    start_time = time.time()
    
    try:
        logger.info(f"🔍 Starting results consolidation - Request ID: {context.aws_request_id}")
        logger.info(f"📥 Processing {len(event)} image results")
        
        # Extract successful results - include both completion statuses
        success_statuses = ['COMPLETED', 'COMPLETED_WITH_MODEL_REUSE']
        successful_results = [r for r in event if r.get('status') in success_statuses]
        failed_results = [r for r in event if r.get('status') not in success_statuses]
        
        logger.info(f"✅ Successful analyses: {len(successful_results)}")
        logger.info(f"❌ Failed analyses: {len(failed_results)}")
        
        if not successful_results:
            # No successful results - generate failure report
            return generate_failure_report(event, failed_results, start_time)
        
        # Calculate aggregate statistics
        statistics = calculate_aggregate_statistics(successful_results)
        
        # PHASE 4.4: Calculate confidence scores
        confidence_scores = calculate_confidence_scores(successful_results, statistics)
        
        # Determine risk level and alert type
        risk_assessment = assess_deforestation_risk(statistics, successful_results)
        
        # PHASE 6.2: Track alert quality metrics
        alert_quality_metrics = track_alert_quality(
            statistics=statistics,
            risk_assessment=risk_assessment,
            confidence_scores=confidence_scores,
            processing_results=successful_results
        )
        
        # Generate detailed PDF report and upload to S3
        pdf_download_url = None
        try:
            pdf_report = generate_detailed_pdf_report(
                statistics=statistics,
                risk_assessment=risk_assessment,
                confidence_scores=confidence_scores,
                total_images=len(event),
                successful_analyses=len(successful_results),
                failed_analyses=len(failed_results),
                processing_results=successful_results,
                alert_quality_metrics=alert_quality_metrics
            )
            
            # Upload PDF to S3 and get pre-signed URL
            pdf_download_url = upload_pdf_to_s3(pdf_report, risk_assessment['level'])
            
            logger.info(f"📄 PDF report generated and uploaded successfully ({len(pdf_report)} bytes)")
            
        except Exception as e:
            logger.error(f"❌ PDF generation failed: {str(e)}")
            pdf_download_url = None
        
        # Generate email content with confidence information (AFTER PDF generation)
        email_content = generate_email_content(
            statistics=statistics,
            risk_assessment=risk_assessment,
            confidence_scores=confidence_scores,
            total_images=len(event),
            successful_analyses=len(successful_results),
            failed_analyses=len(failed_results),
            processing_results=successful_results,
            pdf_download_url=pdf_download_url
        )
        
        # Calculate processing time
        processing_time_ms = int((time.time() - start_time) * 1000)
        
        # Prepare consolidated response
        response = {
            'workflow_status': 'COMPLETED',
            'total_images_processed': len(event),
            'successful_analyses': len(successful_results),
            'failed_analyses': len(failed_results),
            'processing_timestamp': datetime.utcnow().isoformat() + 'Z',
            'statistics': statistics,
            'risk_assessment': risk_assessment,
            'confidence_scores': confidence_scores,  # PHASE 4.4: Include confidence metrics
            'alert_quality_metrics': alert_quality_metrics,  # PHASE 6.2: Include quality tracking
            'email_content': email_content,
            'pdf_report': {
                'download_url': pdf_download_url,
                'expires_in_days': 7
            } if pdf_download_url else None,
            'processing_time_ms': processing_time_ms,
            'results': event  # Include original results for reference
        }
        
        # PHASE 6.1: Track model performance for each analyzed tile
        try:
            for result in successful_results:
                if result.get('imageId'):
                    tile_id = result['imageId'].split('_')[0]
                    
                    # Invoke model-manager for performance tracking
                    lambda_client.invoke(
                        FunctionName='forestshield-model-manager',
                        InvocationType='Event',  # Async invoke - don't wait
                        Payload=json.dumps({
                            'mode': 'track-model-performance',
                            'tile_id': tile_id,
                            'model_metadata': {
                                'model_s3_path': result.get('sagemaker_training_data', ''),
                                'source_image_id': result.get('imageId', ''),
                                'processing_time_ms': processing_time_ms,
                                'pixels_analyzed': result.get('pixel_count', 0),
                                'model_reused': result.get('model_reused', False)
                            },
                            'performance_metrics': confidence_scores
                        })
                    )
            logger.info("📊 Performance tracking initiated for all tiles")
        except Exception as e:
            logger.warning(f"⚠️ Performance tracking failed (non-critical): {str(e)}")
        
        logger.info(f"✅ Results consolidated in {processing_time_ms}ms")
        logger.info(f"🎯 Risk Level: {risk_assessment['level']}")
        logger.info(f"📊 Avg Vegetation: {statistics['avg_vegetation_coverage']:.1f}%")
        logger.info(f"🎯 Confidence: {confidence_scores['confidence_level']} ({confidence_scores['overall_confidence']:.1%})")
        logger.info(f"📈 Alert Quality Score: {alert_quality_metrics.get('overall_quality_score', 0):.2f}")
        
        return response
        
    except Exception as e:
        processing_time_ms = int((time.time() - start_time) * 1000)
        error_message = str(e)
        
        logger.error(f"❌ Results consolidation failed: {error_message}")
        logger.error(f"⏱️ Failed after {processing_time_ms}ms")
        
        return {
            'workflow_status': 'CONSOLIDATION_FAILED',
            'error': error_message,
            'processing_time_ms': processing_time_ms,
            'email_content': {
                'subject': '🚨 ForestShield System Error',
                'message': f'ForestShield encountered an error during results consolidation: {error_message}'
            }
        }

def calculate_aggregate_statistics(results: List[Dict[str, Any]]) -> Dict[str, float]:
    """Calculate aggregate statistics from successful NDVI analyses"""
    
    vegetation_coverages = []
    ndvi_means = []
    ndvi_mins = []
    ndvi_maxs = []
    total_pixels = 0
    valid_pixels = 0
    
    for result in results:
        stats = result.get('statistics', {})
        if stats:
            vegetation_coverages.append(stats.get('vegetation_coverage', 0))
            ndvi_means.append(stats.get('mean_ndvi', 0))
            ndvi_mins.append(stats.get('min_ndvi', 0))
            ndvi_maxs.append(stats.get('max_ndvi', 0))
            total_pixels += stats.get('total_pixels', 0)
            valid_pixels += stats.get('valid_pixels', 0)
    
    return {
        'avg_vegetation_coverage': mean(vegetation_coverages) if vegetation_coverages else 0.0,
        'min_vegetation_coverage': min(vegetation_coverages) if vegetation_coverages else 0.0,
        'max_vegetation_coverage': max(vegetation_coverages) if vegetation_coverages else 0.0,
        'std_vegetation_coverage': stdev(vegetation_coverages) if len(vegetation_coverages) > 1 else 0.0,
        'avg_ndvi': mean(ndvi_means) if ndvi_means else 0.0,
        'min_ndvi': min(ndvi_mins) if ndvi_mins else 0.0,
        'max_ndvi': max(ndvi_maxs) if ndvi_maxs else 0.0,
        'std_ndvi': stdev(ndvi_means) if len(ndvi_means) > 1 else 0.0,
        'total_pixels_analyzed': total_pixels,
        'valid_pixels_analyzed': valid_pixels,
        'data_quality_percentage': (valid_pixels / total_pixels * 100) if total_pixels > 0 else 0.0
    }

def assess_deforestation_risk(statistics: Dict[str, float], processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    PHASE 4.1: Intelligent cluster-based risk assessment using model comparison
    Replaces threshold-based analysis with ML-driven change detection
    """
    
    try:
        # Extract model information from processing results
        model_analysis = analyze_model_usage(processing_results)
        
        # Perform cluster-based change detection if multiple models exist
        change_detection = perform_cluster_change_detection(processing_results)
        
        # Determine risk level based on model analysis and change detection
        risk_level = determine_intelligent_risk_level(model_analysis, change_detection, statistics)
        
        return {
            'level': risk_level['level'],
            'priority': risk_level['priority'],
            'description': risk_level['description'],
            'action_required': risk_level['action_required'],
            'risk_factors': risk_level['risk_factors'],
            'model_analysis': model_analysis,
            'change_detection': change_detection
        }
        
    except Exception as e:
        logger.warning(f"⚠️ Cluster-based analysis failed, falling back to basic reporting: {str(e)}")
        
        # Fallback to basic data reporting
        avg_vegetation = statistics['avg_vegetation_coverage']
        avg_ndvi = statistics['avg_ndvi']
        min_vegetation = statistics['min_vegetation_coverage']
        max_vegetation = statistics['max_vegetation_coverage']
        
        return {
            'level': 'INFO',
            'priority': 'DATA_REPORT',
            'description': 'Vegetation analysis completed (basic mode)',
            'action_required': 'Review data and assess based on local knowledge',
            'risk_factors': [
                f'Average vegetation coverage: {avg_vegetation:.1f}%',
                f'Vegetation range: {min_vegetation:.1f}% - {max_vegetation:.1f}%',
                f'Average NDVI: {avg_ndvi:.3f}',
                f'NDVI range: {statistics["min_ndvi"]:.3f} - {statistics["max_ndvi"]:.3f}',
                f'Data quality: {statistics["data_quality_percentage"]:.1f}% valid pixels'
            ],
            'model_analysis': {'status': 'fallback_mode'},
            'change_detection': {'status': 'not_available'}
        }

def analyze_model_usage(processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analyze model usage patterns across processing results
    """
    model_reused_count = 0
    new_models_trained = 0
    unique_tiles = set()
    
    for result in processing_results:
        if result.get('model_reused'):
            model_reused_count += 1
        else:
            new_models_trained += 1
            
        # Extract tile_id from imageId
        image_id = result.get('imageId', '')
        if image_id:
            tile_id = image_id.split('_')[0]  # e.g., S2A_22MBU_... -> S2A
            unique_tiles.add(tile_id)
    
    return {
        'total_images': len(processing_results),
        'models_reused': model_reused_count,
        'new_models_trained': new_models_trained,
        'unique_tiles': list(unique_tiles),
        'model_efficiency': (model_reused_count / len(processing_results)) * 100 if processing_results else 0
    }

def perform_cluster_change_detection(processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Perform cluster-based change detection using model-manager
    """
    try:
        # Group results by tile_id to find temporal comparisons
        tile_groups = {}
        for result in processing_results:
            image_id = result.get('imageId', '')
            if image_id:
                tile_id = image_id.split('_')[0]
                if tile_id not in tile_groups:
                    tile_groups[tile_id] = []
                tile_groups[tile_id].append(result)
        
        change_detections = []
        
        for tile_id, results in tile_groups.items():
            # Get model history for this tile
            try:
                payload = {
                    'mode': 'get-model-history',
                    'tile_id': tile_id
                }
                
                response = lambda_client.invoke(
                    FunctionName='forestshield-model-manager',
                    Payload=json.dumps(payload)
                )
                
                response_payload = json.loads(response['Payload'].read())
                models = response_payload.get('models', [])
                
                if len(models) >= 2:
                    # We have multiple models for temporal comparison
                    latest_model = models[0]  # Most recent
                    historical_model = models[-1]  # Oldest
                    
                    # Get the most recent pixel data for comparison
                    current_result = results[0] if results else None
                    pixel_data_path = current_result.get('sagemaker_training_data') if current_result else None
                    
                    if pixel_data_path:
                        # Call model comparison
                        compare_payload = {
                            'mode': 'compare-models',
                            'tile_id': tile_id,
                            'current_model_path': latest_model['model_s3_path'],
                            'historical_model_path': historical_model['model_s3_path'],
                            'pixel_data_path': pixel_data_path
                        }
                        
                        compare_response = lambda_client.invoke(
                            FunctionName='forestshield-model-manager',
                            Payload=json.dumps(compare_payload)
                        )
                        
                        comparison_result = json.loads(compare_response['Payload'].read())
                        change_detections.append({
                            'tile_id': tile_id,
                            'comparison': comparison_result,
                            'temporal_span': f"{historical_model['model_version']} to {latest_model['model_version']}"
                        })
                
            except Exception as e:
                logger.warning(f"⚠️ Change detection failed for tile {tile_id}: {str(e)}")
                continue
        
        return {
            'status': 'completed' if change_detections else 'no_temporal_data',
            'tiles_analyzed': len(tile_groups),
            'change_detections': change_detections,
            'temporal_comparisons_available': len(change_detections)
        }
        
    except Exception as e:
        logger.error(f"❌ Cluster change detection failed: {str(e)}")
        return {
            'status': 'failed',
            'error': str(e)
        }

def determine_intelligent_risk_level(model_analysis: Dict[str, Any], change_detection: Dict[str, Any], statistics: Dict[str, float]) -> Dict[str, Any]:
    """
    Determine risk level based on intelligent model analysis and change detection
    """
    
    # Check for significant change detection results
    high_risk_indicators = []
    medium_risk_indicators = []
    info_indicators = []
    
    # Analyze change detection results
    if change_detection.get('status') == 'completed':
        for detection in change_detection.get('change_detections', []):
            comparison = detection.get('comparison', {})
            change_metrics = comparison.get('change_detection', {})
            
            # Future: When real comparison is implemented, these will be actual values
            pixels_changed = change_metrics.get('pixels_changed_clusters', 0)
            forest_to_degraded = change_metrics.get('forest_to_degraded', 0)
            degraded_to_deforested = change_metrics.get('degraded_to_deforested', 0)
            
            if forest_to_degraded > 0 or degraded_to_deforested > 0:
                high_risk_indicators.append(f"Cluster migration detected in {detection['tile_id']}")
            elif pixels_changed > 0:
                medium_risk_indicators.append(f"Vegetation changes detected in {detection['tile_id']}")
    
    # Analyze model efficiency and coverage
    model_efficiency = model_analysis.get('model_efficiency', 0)
    if model_efficiency > 80:
        info_indicators.append(f"High model reuse efficiency: {model_efficiency:.1f}%")
    
    unique_tiles = len(model_analysis.get('unique_tiles', []))
    if unique_tiles > 1:
        info_indicators.append(f"Multi-region analysis: {unique_tiles} different areas")
    
    # Add traditional metrics as supplementary info
    avg_vegetation = statistics['avg_vegetation_coverage']
    avg_ndvi = statistics['avg_ndvi']
    info_indicators.extend([
        f'Average vegetation coverage: {avg_vegetation:.1f}%',
        f'Average NDVI: {avg_ndvi:.3f}',
        f'Data quality: {statistics["data_quality_percentage"]:.1f}% valid pixels'
    ])
    
    # Determine final risk level
    if high_risk_indicators:
        return {
            'level': 'HIGH',
            'priority': 'CHANGE_DETECTED',
            'description': 'Significant vegetation changes detected through cluster analysis',
            'action_required': 'Immediate investigation of detected changes recommended',
            'risk_factors': high_risk_indicators + medium_risk_indicators + info_indicators
        }
    elif medium_risk_indicators:
        return {
            'level': 'MEDIUM',
            'priority': 'MONITORING_REQUIRED',
            'description': 'Moderate vegetation changes detected',
            'action_required': 'Continue monitoring for trend development',
            'risk_factors': medium_risk_indicators + info_indicators
        }
    else:
        return {
            'level': 'INFO',
            'priority': 'STABLE_CONDITIONS',
            'description': 'Intelligent analysis shows stable vegetation patterns',
            'action_required': 'Regular monitoring schedule maintained',
            'risk_factors': info_indicators
        }

def calculate_confidence_scores(processing_results: List[Dict[str, Any]], statistics: Dict[str, float]) -> Dict[str, Any]:
    """
    PHASE 4.4: Comprehensive confidence scoring system
    
    Calculates multiple confidence metrics:
    1. Distance-to-cluster-center confidence
    2. Historical consistency scoring
    3. Spatial coherence scoring
    4. Overall alert reliability score
    """
    
    try:
        logger.info("🎯 PHASE 4.4: Calculating confidence scores...")
        
        confidence_metrics = {
            'distance_to_center_confidence': 0.0,
            'historical_consistency_confidence': 0.0,
            'spatial_coherence_confidence': 0.0,
            'data_quality_confidence': 0.0,
            'overall_confidence': 0.0,
            'confidence_factors': []
        }
        
        # 1. Data Quality Confidence (based on valid pixels and processing success)
        total_images = len(processing_results)
        # Count successful analyses using both completion statuses
        success_statuses = ['COMPLETED', 'COMPLETED_WITH_MODEL_REUSE']
        successful_images = len([r for r in processing_results if r.get('status') in success_statuses])
        data_quality_score = (successful_images / total_images) * (statistics.get('data_quality_percentage', 0) / 100.0)
        confidence_metrics['data_quality_confidence'] = data_quality_score
        
        if data_quality_score > 0.9:
            confidence_metrics['confidence_factors'].append("Excellent data quality (>90%)")
        elif data_quality_score > 0.7:
            confidence_metrics['confidence_factors'].append("Good data quality (70-90%)")
        else:
            confidence_metrics['confidence_factors'].append("Moderate data quality (<70%)")
        
        # 2. Historical Consistency Confidence (based on model reuse)
        model_reused_count = sum(1 for r in processing_results if r.get('model_reused', False))
        historical_consistency = model_reused_count / total_images if total_images > 0 else 0
        confidence_metrics['historical_consistency_confidence'] = historical_consistency
        
        if historical_consistency > 0.8:
            confidence_metrics['confidence_factors'].append("High model consistency (>80% reuse)")
        elif historical_consistency > 0.5:
            confidence_metrics['confidence_factors'].append("Moderate model consistency (50-80% reuse)")
        else:
            confidence_metrics['confidence_factors'].append("Low model consistency (<50% reuse)")
        
        # 3. Spatial Coherence Confidence (based on NDVI variance)
        ndvi_variance = statistics.get('std_vegetation_coverage', 0)
        ndvi_mean = statistics.get('avg_vegetation_coverage', 0)
        
        # Lower variance relative to mean indicates better spatial coherence
        if ndvi_mean > 0:
            coefficient_of_variation = ndvi_variance / ndvi_mean
            spatial_coherence = max(0, 1 - (coefficient_of_variation / 0.5))  # Normalize to 0-1
        else:
            spatial_coherence = 0.5  # Neutral if no vegetation data
            
        confidence_metrics['spatial_coherence_confidence'] = spatial_coherence
        
        if spatial_coherence > 0.8:
            confidence_metrics['confidence_factors'].append("High spatial coherence (low variance)")
        elif spatial_coherence > 0.6:
            confidence_metrics['confidence_factors'].append("Moderate spatial coherence")
        else:
            confidence_metrics['confidence_factors'].append("Low spatial coherence (high variance)")
        
        # 4. Multi-region Coverage Confidence
        unique_tiles = set()
        for result in processing_results:
            image_id = result.get('imageId', '')
            if image_id:
                tile_id = image_id.split('_')[0]
                unique_tiles.add(tile_id)
        
        multi_region_factor = min(len(unique_tiles) / 3.0, 1.0)  # Bonus for covering multiple regions
        if len(unique_tiles) > 1:
            confidence_metrics['confidence_factors'].append(f"Multi-region analysis ({len(unique_tiles)} regions)")
        
        # 5. Calculate Overall Confidence Score
        weights = {
            'data_quality': 0.35,
            'historical_consistency': 0.25,
            'spatial_coherence': 0.25,
            'multi_region': 0.15
        }
        
        overall_confidence = (
            data_quality_score * weights['data_quality'] +
            historical_consistency * weights['historical_consistency'] +
            spatial_coherence * weights['spatial_coherence'] +
            multi_region_factor * weights['multi_region']
        )
        
        confidence_metrics['overall_confidence'] = overall_confidence
        
        # Categorize overall confidence
        if overall_confidence >= 0.8:
            confidence_level = "HIGH"
            confidence_desc = "Very reliable analysis with strong confidence indicators"
        elif overall_confidence >= 0.6:
            confidence_level = "MEDIUM"
            confidence_desc = "Moderately reliable analysis with some confidence indicators"
        elif overall_confidence >= 0.4:
            confidence_level = "LOW"
            confidence_desc = "Analysis completed but with limited confidence indicators"
        else:
            confidence_level = "VERY_LOW"
            confidence_desc = "Analysis completed but confidence is limited"
        
        confidence_metrics['confidence_level'] = confidence_level
        confidence_metrics['confidence_description'] = confidence_desc
        
        logger.info(f"🎯 Confidence Analysis: {confidence_level} ({overall_confidence:.2f})")
        logger.info(f"   Data Quality: {data_quality_score:.2f}")
        logger.info(f"   Historical Consistency: {historical_consistency:.2f}")
        logger.info(f"   Spatial Coherence: {spatial_coherence:.2f}")
        
        return confidence_metrics
        
    except Exception as e:
        logger.error(f"❌ Confidence scoring failed: {str(e)}")
        return {
            'distance_to_center_confidence': 0.0,
            'historical_consistency_confidence': 0.0,
            'spatial_coherence_confidence': 0.0,
            'data_quality_confidence': 0.0,
            'overall_confidence': 0.0,
            'confidence_level': 'UNKNOWN',
            'confidence_description': 'Confidence scoring failed',
            'confidence_factors': ['Confidence calculation error']
        }

def extract_visualization_links(processing_results: List[Dict[str, Any]]) -> Dict[str, str]:
    """
    Extract visualization URLs from processing results
    """
    visualization_links = {}
    
    for result in processing_results:
        visualizations = result.get('visualizations', {})
        if isinstance(visualizations, dict):
            # Extract visualization URLs from the response body
            viz_body = visualizations.get('body')
            if viz_body:
                try:
                    # Parse the JSON body if it's a string
                    if isinstance(viz_body, str):
                        import json
                        viz_data = json.loads(viz_body)
                    else:
                        viz_data = viz_body
                    
                    # Extract visualization URLs
                    viz_urls = viz_data.get('visualizations', {})
                    if viz_urls:
                        # Use the first set of visualizations found
                        visualization_links.update(viz_urls)
                        break  # Only use the first result with visualizations
                        
                except Exception as e:
                    logger.warning(f"⚠️ Failed to parse visualization data: {str(e)}")
                    continue
    
    return visualization_links


def upload_pdf_to_s3(pdf_bytes: bytes, risk_level: str) -> str:
    """Upload PDF report to S3 and return pre-signed URL"""
    
    try:
        s3_client = boto3.client('s3')
        
        # Generate unique filename
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
        filename = f"reports/{timestamp}/ForestShield_Report_{risk_level}_{timestamp}.pdf"
        
        # Upload to S3
        s3_client.put_object(
            Bucket=PROCESSED_DATA_BUCKET,
            Key=filename,
            Body=pdf_bytes,
            ContentType='application/pdf',
            ServerSideEncryption='AES256',
            Metadata={
                'risk-level': risk_level,
                'generated-by': 'forestshield-results-consolidator',
                'timestamp': timestamp
            }
        )
        
        # Generate pre-signed URL (valid for 7 days)
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': PROCESSED_DATA_BUCKET, 'Key': filename},
            ExpiresIn=604800  # 7 days
        )
        
        logger.info(f"📄 PDF uploaded to S3: s3://{PROCESSED_DATA_BUCKET}/{filename}")
        return presigned_url
        
    except Exception as e:
        logger.error(f"❌ Failed to upload PDF to S3: {str(e)}")
        return None


def generate_detailed_pdf_report(statistics: Dict[str, float], risk_assessment: Dict[str, Any], 
                               confidence_scores: Dict[str, Any], total_images: int, successful_analyses: int, 
                               failed_analyses: int, processing_results: List[Dict[str, Any]], 
                               alert_quality_metrics: Dict[str, Any]) -> bytes:
    """Generate a comprehensive PDF report with all analysis details"""
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=18)
    
    # Get styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=30,
        textColor=HexColor('#2E8B57'),
        fontName='Helvetica-Bold'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=12,
        textColor=HexColor('#1F4E79'),
        fontName='Helvetica-Bold'
    )
    
    story = []
    
    # Title
    story.append(Paragraph("🛡️ ForestShield Deforestation Detection Report", title_style))
    story.append(Spacer(1, 12))
    
    # Executive Summary
    story.append(Paragraph("Executive Summary", heading_style))
    
    risk_level = risk_assessment['level']
    confidence_level = confidence_scores['confidence_level']
    
    summary_data = [
        ['Metric', 'Value'],
        ['Alert Level', risk_level],
        ['Confidence', f"{confidence_level} ({confidence_scores['overall_confidence']:.1%})"],
        ['Risk Priority', risk_assessment['priority']],
        ['Status', risk_assessment['description']],
        ['Analysis Date', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')],
        ['Images Processed', f"{successful_analyses}/{total_images}"],
        ['Data Quality', f"{statistics['data_quality_percentage']:.1f}% valid pixels"]
    ]
    
    summary_table = Table(summary_data, colWidths=[2*inch, 3*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(summary_table)
    story.append(Spacer(1, 20))
    
    # Vegetation Analysis
    story.append(Paragraph("Vegetation Analysis", heading_style))
    
    vegetation_data = [
        ['Metric', 'Value'],
        ['Average Vegetation Coverage', f"{statistics['avg_vegetation_coverage']:.1f}%"],
        ['Vegetation Range', f"{statistics['min_vegetation_coverage']:.1f}% - {statistics['max_vegetation_coverage']:.1f}%"],
        ['Standard Deviation', f"{statistics['std_vegetation_coverage']:.2f}%"],
        ['Average NDVI', f"{statistics['avg_ndvi']:.3f}"],
        ['NDVI Range', f"{statistics['min_ndvi']:.3f} - {statistics['max_ndvi']:.3f}"],
        ['NDVI Standard Deviation', f"{statistics['std_ndvi']:.3f}"],
        ['Total Pixels Analyzed', f"{statistics['total_pixels_analyzed']:,}"],
        ['Valid Pixels', f"{statistics['valid_pixels_analyzed']:,}"]
    ]
    
    vegetation_table = Table(vegetation_data, colWidths=[2.5*inch, 2.5*inch])
    vegetation_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(vegetation_table)
    story.append(Spacer(1, 20))
    
    # Risk Assessment Details
    story.append(Paragraph("Risk Assessment Details", heading_style))
    
    for risk_factor in risk_assessment['risk_factors']:
        story.append(Paragraph(f"• {risk_factor}", styles['Normal']))
    
    story.append(Spacer(1, 12))
    story.append(Paragraph(f"<b>Recommended Action:</b> {risk_assessment['action_required']}", styles['Normal']))
    story.append(Spacer(1, 20))
    
    # Confidence Analysis
    story.append(Paragraph("Confidence Analysis", heading_style))
    story.append(Paragraph(f"<b>Overall Confidence:</b> {confidence_scores['confidence_level']} ({confidence_scores['overall_confidence']:.1%})", styles['Normal']))
    story.append(Paragraph(f"<b>Assessment:</b> {confidence_scores['confidence_description']}", styles['Normal']))
    story.append(Spacer(1, 12))
    
    story.append(Paragraph("<b>Confidence Factors:</b>", styles['Normal']))
    for factor in confidence_scores.get('confidence_factors', []):
        story.append(Paragraph(f"• {factor}", styles['Normal']))
    
    story.append(Spacer(1, 20))
    
    # Intelligent Analysis
    model_analysis = risk_assessment.get('model_analysis', {})
    change_detection = risk_assessment.get('change_detection', {})
    
    if model_analysis.get('status') != 'fallback_mode':
        story.append(Paragraph("Intelligent Analysis", heading_style))
        
        intelligence_data = [
            ['Metric', 'Value'],
            ['Model Efficiency', f"{model_analysis.get('model_efficiency', 0):.1f}%"],
            ['Models Reused', str(model_analysis.get('models_reused', 0))],
            ['New Models Trained', str(model_analysis.get('new_models_trained', 0))],
            ['Geographic Coverage', f"{len(model_analysis.get('unique_tiles', []))} regions"],
            ['Temporal Comparisons', str(change_detection.get('temporal_comparisons_available', 0))],
            ['Change Detection Status', change_detection.get('status', 'N/A')]
        ]
        
        intelligence_table = Table(intelligence_data, colWidths=[2.5*inch, 2.5*inch])
        intelligence_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
            ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
            ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE', (0, 0), (-1, 0), 12),
            ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
            ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
            ('GRID', (0, 0), (-1, -1), 1, colors.black)
        ]))
        
        story.append(intelligence_table)
        story.append(Spacer(1, 20))
    
    # Alert Quality Metrics
    if alert_quality_metrics:
        story.append(Paragraph("Alert Quality Metrics", heading_style))
        
        overall_score = alert_quality_metrics.get('overall_quality_score', 0)
        story.append(Paragraph(f"<b>Overall Quality Score:</b> {overall_score:.2f}/5.0", styles['Normal']))
        
        # Add quality breakdown if available
        threshold_comparison = alert_quality_metrics.get('threshold_comparison', {})
        if threshold_comparison:
            story.append(Paragraph(f"<b>Threshold System Comparison:</b> {threshold_comparison.get('agreement_level', 'N/A')}", styles['Normal']))
        
        story.append(Spacer(1, 20))
    
    # Individual Image Results
    if len(processing_results) <= 20:  # Only show details for smaller datasets
        story.append(Paragraph("Individual Image Analysis", heading_style))
        
        image_data = [['Image ID', 'Vegetation Coverage', 'Mean NDVI', 'Status']]
        
        for result in processing_results:
            stats = result.get('statistics', {})
            image_id = result.get('imageId', 'Unknown')
            vegetation = stats.get('vegetation_coverage', 0)
            ndvi = stats.get('mean_ndvi', 0)
            status = result.get('status', 'Unknown')
            
            image_data.append([
                image_id,
                f"{vegetation:.1f}%",
                f"{ndvi:.3f}",
                status
            ])
        
        if len(image_data) > 1:  # Only create table if we have data
            image_table = Table(image_data, colWidths=[2*inch, 1.5*inch, 1*inch, 1.5*inch])
            image_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('FONTSIZE', (0, 1), (-1, -1), 9),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                ('GRID', (0, 0), (-1, -1), 1, colors.black)
            ]))
            
            story.append(image_table)
            story.append(Spacer(1, 20))
    
    # Technical Details
    story.append(Paragraph("Technical Details", heading_style))
    
    tech_details = [
        "• Satellite Data Source: Sentinel-2",
        "• Analysis Method: K-means clustering with 5D features (NDVI, Red, NIR, Latitude, Longitude)",
        "• NDVI Calculation: (NIR - Red) / (NIR + Red)",
        "• Machine Learning: Intelligent model reuse and historical comparison",
        "• Processing: Real-time AWS Lambda functions",
        "• Storage: Amazon S3 with automated lifecycle management"
    ]
    
    for detail in tech_details:
        story.append(Paragraph(detail, styles['Normal']))
    
    story.append(Spacer(1, 20))
    
    # Visualization Links
    visualization_links = extract_visualization_links(processing_results)
    if visualization_links:
        story.append(Paragraph("K-means Clustering Visualizations", heading_style))
        
        viz_data = [['Visualization Type', 'Access Link']]
        for viz_name, viz_url in visualization_links.items():
            viz_display_name = viz_name.replace('_', ' ').title()
            viz_data.append([viz_display_name, viz_url])
        
        if len(viz_data) > 1:
            viz_table = Table(viz_data, colWidths=[2*inch, 4*inch])
            viz_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.grey),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.beige),
                ('GRID', (0, 0), (-1, -1), 1, colors.black)
            ]))
            
            story.append(viz_table)
    
    # Footer
    story.append(Spacer(1, 30))
    story.append(Paragraph("<i>This report was generated automatically by ForestShield forest monitoring system.</i>", styles['Normal']))
    story.append(Paragraph("<i>🛡️ ForestShield - Protecting our forests with satellite intelligence</i>", styles['Normal']))
    
    # Build PDF
    doc.build(story)
    
    # Get PDF bytes
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    return pdf_bytes


def generate_email_content(statistics: Dict[str, float], risk_assessment: Dict[str, Any], 
                          confidence_scores: Dict[str, Any], total_images: int, successful_analyses: int, failed_analyses: int,
                          processing_results: List[Dict[str, Any]], pdf_download_url: str = None) -> Dict[str, str]:
    """Generate simplified email content for SNS alerts - detailed report attached as PDF"""
    
    risk_level = risk_assessment['level']
    
    # Subject line based on risk level
    subject_emojis = {
        'HIGH': '🚨 URGENT',
        'MEDIUM': '⚠️ WARNING',
        'INFO': 'ℹ️ INFO'
    }
    
    subject = f"{subject_emojis[risk_level]}: {risk_assessment['description']} - ForestShield Alert"
    
    # Generate simplified message
    message_parts = [
        "🛡️ ForestShield Forest Monitoring Alert",
        "",
        f"🎯 ALERT LEVEL: {risk_level}",
        f"🔍 STATUS: {risk_assessment['description']}",
        f"🎯 CONFIDENCE: {confidence_scores['confidence_level']} ({confidence_scores['overall_confidence']:.1%})",
        "",
        "📊 QUICK SUMMARY:",
        f"• Images Analyzed: {successful_analyses}/{total_images}",
        f"• Average Vegetation Coverage: {statistics['avg_vegetation_coverage']:.1f}%",
        f"• Average NDVI: {statistics['avg_ndvi']:.3f}",
        f"• Data Quality: {statistics['data_quality_percentage']:.1f}% valid pixels",
        "",
        f"💡 RECOMMENDED ACTION: {risk_assessment['action_required']}",
        "",
        "📄 DETAILED ANALYSIS:",
        "A comprehensive PDF report with complete analysis details,",
        "including vegetation metrics, confidence analysis, intelligent",
        "model insights, and technical details is available for download:",
        "",
        f"📥 Download Report: {pdf_download_url}" if pdf_download_url else "📥 Download Report: Generation failed - check logs",
        "⏰ Link expires: 7 days from analysis",
        "",
        "📧 MANAGE ALERTS:",
        f"• Dashboard: {API_BASE_URL}/dashboard/alerts",
        f"• Unsubscribe: {API_BASE_URL}/dashboard/alerts/unsubscribe",
        "",
        f"Analysis completed: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC",
        "",
        "🛡️ ForestShield - Protecting our forests with satellite intelligence"
    ]
    
    return {
        'subject': subject,
        'message': '\n'.join(message_parts)
    }

def generate_failure_report(all_results: List[Dict[str, Any]], failed_results: List[Dict[str, Any]], 
                           start_time: float) -> Dict[str, Any]:
    """Generate report when all analyses failed"""
    
    processing_time_ms = int((time.time() - start_time) * 1000)
    
    # Generate simplified failure email
    email_content = {
            'subject': '🚨 URGENT: ForestShield Analysis Failure',
            'message': f"""🛡️ ForestShield System Alert

🚨 SYSTEM STATUS: ALL ANALYSES FAILED

📊 QUICK SUMMARY:
• Images Attempted: {len(all_results)}
• Successful Analyses: 0
• Failed Analyses: {len(failed_results)}
• Success Rate: 0%

💡 RECOMMENDED ACTION: 
Immediate system investigation required.

📄 DETAILED ANALYSIS:
A comprehensive PDF error report with detailed failure
information and troubleshooting steps is attached.

📧 MANAGE ALERTS:
• Dashboard: {API_BASE_URL}/dashboard
• Unsubscribe: {API_BASE_URL}/dashboard/alerts/unsubscribe

System check: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC

🛡️ ForestShield - Protecting our forests with satellite intelligence"""
    }
    
    # Generate detailed failure PDF report and upload to S3
    pdf_download_url = None
    try:
        pdf_report = generate_failure_pdf_report(all_results, failed_results, processing_time_ms)
        pdf_download_url = upload_pdf_to_s3(pdf_report, 'FAILURE')
        logger.info(f"📄 Failure PDF report generated and uploaded successfully ({len(pdf_report)} bytes)")
    except Exception as e:
        logger.error(f"❌ Failure PDF generation failed: {str(e)}")
        pdf_download_url = None
    
    # Update email content to include PDF download link
    if pdf_download_url:
        email_content['message'] = email_content['message'].replace(
            "A comprehensive PDF error report with detailed failure\ninformation and troubleshooting steps is attached.",
            f"A comprehensive PDF error report with detailed failure\ninformation and troubleshooting steps is available:\n\n📥 Download Report: {pdf_download_url}\n⏰ Link expires: 7 days from analysis"
        )
    
    return {
        'workflow_status': 'ALL_ANALYSES_FAILED',
        'total_images_processed': len(all_results),
        'successful_analyses': 0,
        'failed_analyses': len(failed_results),
        'processing_timestamp': datetime.utcnow().isoformat() + 'Z',
        'processing_time_ms': processing_time_ms,
        'email_content': email_content,
        'pdf_report': {
            'download_url': pdf_download_url,
            'expires_in_days': 7
        } if pdf_download_url else None,
        'results': all_results
    }


def generate_failure_pdf_report(all_results: List[Dict[str, Any]], failed_results: List[Dict[str, Any]], 
                               processing_time_ms: int) -> bytes:
    """Generate a PDF report for system failures"""
    
    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=72, leftMargin=72, topMargin=72, bottomMargin=18)
    
    # Get styles
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=18,
        spaceAfter=30,
        textColor=HexColor('#DC143C'),  # Crimson for error
        fontName='Helvetica-Bold'
    )
    
    heading_style = ParagraphStyle(
        'CustomHeading',
        parent=styles['Heading2'],
        fontSize=14,
        spaceAfter=12,
        textColor=HexColor('#8B0000'),  # Dark red
        fontName='Helvetica-Bold'
    )
    
    story = []
    
    # Title
    story.append(Paragraph("🚨 ForestShield System Failure Report", title_style))
    story.append(Spacer(1, 12))
    
    # Executive Summary
    story.append(Paragraph("System Status Summary", heading_style))
    
    summary_data = [
        ['Metric', 'Value'],
        ['System Status', 'ALL ANALYSES FAILED'],
        ['Images Attempted', str(len(all_results))],
        ['Successful Analyses', '0'],
        ['Failed Analyses', str(len(failed_results))],
        ['Success Rate', '0%'],
        ['Processing Time', f"{processing_time_ms}ms"],
        ['Timestamp', datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')]
    ]
    
    summary_table = Table(summary_data, colWidths=[2*inch, 3*inch])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.darkred),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.lightcoral),
        ('GRID', (0, 0), (-1, -1), 1, colors.black)
    ]))
    
    story.append(summary_table)
    story.append(Spacer(1, 20))
    
    # Possible Causes
    story.append(Paragraph("Possible Causes", heading_style))
    
    causes = [
        "• Satellite data access issues or API downtime",
        "• Processing system problems or resource limitations",
        "• Network connectivity issues or timeouts",
        "• Lambda function errors or configuration problems",
        "• AWS service outages or regional issues",
        "• Data format inconsistencies or corrupted images"
    ]
    
    for cause in causes:
        story.append(Paragraph(cause, styles['Normal']))
    
    story.append(Spacer(1, 20))
    
    # Recommended Actions
    story.append(Paragraph("Recommended Actions", heading_style))
    
    actions = [
        "• Check AWS CloudWatch logs for detailed error information",
        "• Verify satellite data source availability and access permissions",
        "• Review Lambda function configuration and resource limits",
        "• Check network connectivity and security group settings",
        "• Monitor AWS service status for any ongoing outages",
        "• Validate input data format and integrity",
        "• Contact system administrator if issues persist"
    ]
    
    for action in actions:
        story.append(Paragraph(action, styles['Normal']))
    
    story.append(Spacer(1, 20))
    
    # Failure Details
    if len(failed_results) <= 20:  # Only show details for manageable datasets
        story.append(Paragraph("Failure Details", heading_style))
        
        failure_data = [['Image/Task ID', 'Error Status', 'Error Message']]
        
        for result in failed_results[:20]:  # Limit to first 20 failures
            image_id = result.get('imageId', 'Unknown')
            status = result.get('status', 'FAILED')
            error_msg = result.get('error', 'No error message available')
            
            # Truncate long error messages
            if len(error_msg) > 100:
                error_msg = error_msg[:97] + "..."
                
            failure_data.append([image_id, status, error_msg])
        
        if len(failure_data) > 1:
            failure_table = Table(failure_data, colWidths=[2*inch, 1.5*inch, 2.5*inch])
            failure_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.darkred),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
                ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
                ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
                ('FONTSIZE', (0, 0), (-1, 0), 10),
                ('FONTSIZE', (0, 1), (-1, -1), 8),
                ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
                ('BACKGROUND', (0, 1), (-1, -1), colors.lightcoral),
                ('GRID', (0, 0), (-1, -1), 1, colors.black),
                ('VALIGN', (0, 0), (-1, -1), 'TOP')
            ]))
            
            story.append(failure_table)
    
    # Footer
    story.append(Spacer(1, 30))
    story.append(Paragraph("<i>This failure report was generated automatically by ForestShield monitoring system.</i>", styles['Normal']))
    story.append(Paragraph("<i>🛡️ ForestShield - Protecting our forests with satellite intelligence</i>", styles['Normal']))
    
    # Build PDF
    doc.build(story)
    
    # Get PDF bytes
    pdf_bytes = buffer.getvalue()
    buffer.close()
    
    return pdf_bytes

def track_alert_quality(statistics: Dict[str, float], risk_assessment: Dict[str, Any], 
                       confidence_scores: Dict[str, Any], processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    PHASE 6.2: Track alert quality metrics including false positives, detection sensitivity,
    temporal accuracy, and performance comparison against threshold-based system
    """
    
    try:
        logger.info("📈 PHASE 6.2: Tracking alert quality metrics...")
        
        # Initialize AWS S3 client for storing quality metrics
        s3_client = boto3.client('s3')
        
        # Initialize quality metrics structure
        quality_metrics = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'alert_metadata': {
                'risk_level': risk_assessment['level'],
                'confidence_level': confidence_scores['confidence_level'],
                'overall_confidence': confidence_scores['overall_confidence'],
                'images_processed': len(processing_results)
            },
            'threshold_comparison': {},
            'temporal_accuracy': {},
            'detection_sensitivity': {},
            'false_positive_indicators': {},
            'overall_quality_score': 0.0,
            'quality_factors': []
        }
        
        # 1. Threshold-based comparison (simulate old system)
        threshold_comparison = compare_with_threshold_system(statistics, processing_results)
        quality_metrics['threshold_comparison'] = threshold_comparison
        
        # 2. Calculate temporal accuracy metrics
        temporal_accuracy = calculate_temporal_accuracy(processing_results)
        quality_metrics['temporal_accuracy'] = temporal_accuracy
        
        # 3. Assess detection sensitivity
        detection_sensitivity = assess_detection_sensitivity(statistics, confidence_scores, processing_results)
        quality_metrics['detection_sensitivity'] = detection_sensitivity
        
        # 4. Evaluate false positive indicators
        false_positive_indicators = evaluate_false_positive_risk(statistics, risk_assessment, confidence_scores)
        quality_metrics['false_positive_indicators'] = false_positive_indicators
        
        # 5. Calculate overall quality score
        overall_quality = calculate_overall_quality_score(
            threshold_comparison, temporal_accuracy, detection_sensitivity, false_positive_indicators
        )
        quality_metrics['overall_quality_score'] = overall_quality['score']
        quality_metrics['quality_factors'] = overall_quality['factors']
        
        # 6. Store quality metrics to S3 for historical tracking
        store_alert_quality_metrics(s3_client, quality_metrics, processing_results)
        
        logger.info(f"📈 Alert Quality Analysis Complete - Score: {overall_quality['score']:.2f}")
        return quality_metrics
        
    except Exception as e:
        logger.error(f"❌ Alert quality tracking failed: {str(e)}")
        return {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'alert_metadata': {
                'risk_level': risk_assessment.get('level', 'UNKNOWN'),
                'confidence_level': confidence_scores.get('confidence_level', 'UNKNOWN'),
                'overall_confidence': confidence_scores.get('overall_confidence', 0.0),
                'images_processed': len(processing_results)
            },
            'error': f'Quality tracking failed: {str(e)}',
            'overall_quality_score': 0.0,
            'quality_factors': ['Quality tracking error']
        }

def compare_with_threshold_system(statistics: Dict[str, float], processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Compare intelligent clustering results with traditional threshold-based approach
    """
    
    # Simulate traditional threshold-based detection
    # Traditional thresholds: NDVI < 0.3 = deforested, NDVI 0.3-0.5 = degraded, NDVI > 0.5 = healthy
    
    threshold_results = {
        'deforested_pixels': 0,
        'degraded_pixels': 0,
        'healthy_pixels': 0,
        'threshold_alert_level': 'INFO'
    }
    
    total_pixels = 0
    
    for result in processing_results:
        stats = result.get('statistics', {})
        pixel_count = stats.get('valid_pixels', 0)
        mean_ndvi = stats.get('mean_ndvi', 1.0)
        
        total_pixels += pixel_count
        
        # Apply traditional thresholds
        if mean_ndvi < 0.3:
            threshold_results['deforested_pixels'] += pixel_count
        elif mean_ndvi < 0.5:
            threshold_results['degraded_pixels'] += pixel_count
        else:
            threshold_results['healthy_pixels'] += pixel_count
    
    # Determine threshold-based alert level
    if total_pixels > 0:
        deforested_percentage = (threshold_results['deforested_pixels'] / total_pixels) * 100
        degraded_percentage = (threshold_results['degraded_pixels'] / total_pixels) * 100
        
        if deforested_percentage > 20:
            threshold_results['threshold_alert_level'] = 'HIGH'
        elif deforested_percentage > 10 or degraded_percentage > 30:
            threshold_results['threshold_alert_level'] = 'MEDIUM'
        else:
            threshold_results['threshold_alert_level'] = 'INFO'
    
    # Calculate comparison metrics
    comparison_metrics = {
        'threshold_system': threshold_results,
        'deforested_percentage_threshold': (threshold_results['deforested_pixels'] / total_pixels * 100) if total_pixels > 0 else 0,
        'degraded_percentage_threshold': (threshold_results['degraded_pixels'] / total_pixels * 100) if total_pixels > 0 else 0,
        'healthy_percentage_threshold': (threshold_results['healthy_pixels'] / total_pixels * 100) if total_pixels > 0 else 0,
        'total_pixels_threshold': total_pixels,
        'threshold_vs_clustering_agreement': 'needs_ground_truth_validation',
        'improvement_indicators': []
    }
    
    # Add improvement indicators
    avg_vegetation = statistics.get('avg_vegetation_coverage', 0)
    if avg_vegetation > 50 and threshold_results['threshold_alert_level'] != 'INFO':
        comparison_metrics['improvement_indicators'].append('Clustering may reduce false positives in healthy forests')
    
    if statistics.get('std_vegetation_coverage', 0) > 20:
        comparison_metrics['improvement_indicators'].append('High variance detected - clustering better handles heterogeneous landscapes')
    
    return comparison_metrics

def calculate_temporal_accuracy(processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate temporal accuracy metrics for deforestation detection
    """
    
    temporal_metrics = {
        'processing_timestamps': [],
        'image_acquisition_dates': [],
        'detection_delay_indicators': [],
        'temporal_coverage_analysis': {}
    }
    
    try:
        current_time = datetime.utcnow()
        
        for result in processing_results:
            image_id = result.get('imageId', '')
            
            # Extract date from Sentinel-2 image ID (format: S2A_YYYYMMDD_...)
            if '_' in image_id and len(image_id.split('_')) > 1:
                try:
                    date_part = image_id.split('_')[1]
                    if len(date_part) >= 8 and date_part.isdigit():
                        # Parse YYYYMMDD format
                        year = int(date_part[:4])
                        month = int(date_part[4:6])
                        day = int(date_part[6:8])
                        
                        acquisition_date = datetime(year, month, day)
                        temporal_metrics['image_acquisition_dates'].append(acquisition_date.isoformat())
                        
                        # Calculate detection delay (how long after image acquisition)
                        delay_hours = (current_time - acquisition_date).total_seconds() / 3600
                        temporal_metrics['detection_delay_indicators'].append({
                            'image_id': image_id,
                            'acquisition_date': acquisition_date.isoformat(),
                            'processing_date': current_time.isoformat(),
                            'delay_hours': delay_hours,
                            'delay_category': categorize_detection_delay(delay_hours)
                        })
                        
                except (ValueError, IndexError) as e:
                    logger.warning(f"⚠️ Could not parse date from image ID {image_id}: {str(e)}")
                    continue
        
        # Analyze temporal coverage
        if temporal_metrics['detection_delay_indicators']:
            delays = [d['delay_hours'] for d in temporal_metrics['detection_delay_indicators']]
            temporal_metrics['temporal_coverage_analysis'] = {
                'average_detection_delay_hours': mean(delays),
                'min_detection_delay_hours': min(delays),
                'max_detection_delay_hours': max(delays),
                'std_detection_delay_hours': stdev(delays) if len(delays) > 1 else 0,
                'real_time_processing_percentage': len([d for d in delays if d < 24]) / len(delays) * 100,
                'near_real_time_percentage': len([d for d in delays if d < 72]) / len(delays) * 100
            }
        
        return temporal_metrics
        
    except Exception as e:
        logger.error(f"❌ Temporal accuracy calculation failed: {str(e)}")
        return {
            'error': f'Temporal analysis failed: {str(e)}',
            'processing_timestamps': [],
            'image_acquisition_dates': []
        }

def categorize_detection_delay(delay_hours: float) -> str:
    """Categorize detection delay into performance buckets"""
    if delay_hours < 6:
        return 'REAL_TIME'  # < 6 hours
    elif delay_hours < 24:
        return 'SAME_DAY'   # 6-24 hours
    elif delay_hours < 72:
        return 'NEAR_REAL_TIME'  # 1-3 days
    elif delay_hours < 168:
        return 'WEEKLY'     # 3-7 days
    else:
        return 'DELAYED'    # > 1 week

def assess_detection_sensitivity(statistics: Dict[str, float], confidence_scores: Dict[str, Any], 
                               processing_results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Assess the detection sensitivity of the clustering-based system
    """
    
    sensitivity_metrics = {
        'vegetation_coverage_distribution': {},
        'ndvi_sensitivity_analysis': {},
        'spatial_detection_capability': {},
        'model_reuse_impact': {}
    }
    
    try:
        # Analyze vegetation coverage distribution
        vegetation_coverages = [r.get('statistics', {}).get('vegetation_coverage', 0) for r in processing_results]
        if vegetation_coverages:
            sensitivity_metrics['vegetation_coverage_distribution'] = {
                'mean': mean(vegetation_coverages),
                'std': stdev(vegetation_coverages) if len(vegetation_coverages) > 1 else 0,
                'min': min(vegetation_coverages),
                'max': max(vegetation_coverages),
                'low_vegetation_detections': len([v for v in vegetation_coverages if v < 30]),  # Potential deforestation
                'moderate_vegetation_detections': len([v for v in vegetation_coverages if 30 <= v < 60]),  # Degradation
                'high_vegetation_detections': len([v for v in vegetation_coverages if v >= 60])  # Healthy forest
            }
        
        # Analyze NDVI sensitivity
        ndvi_values = [r.get('statistics', {}).get('mean_ndvi', 0) for r in processing_results]
        if ndvi_values:
            sensitivity_metrics['ndvi_sensitivity_analysis'] = {
                'mean_ndvi': mean(ndvi_values),
                'ndvi_range': max(ndvi_values) - min(ndvi_values),
                'low_ndvi_detections': len([n for n in ndvi_values if n < 0.3]),  # Traditional deforestation threshold
                'moderate_ndvi_detections': len([n for n in ndvi_values if 0.3 <= n < 0.5]),  # Degradation range
                'high_ndvi_detections': len([n for n in ndvi_values if n >= 0.5]),  # Healthy vegetation
                'clustering_advantage': 'Uses spatial+spectral features vs NDVI-only thresholds'
            }
        
        # Analyze spatial detection capability
        total_pixels = sum(r.get('statistics', {}).get('valid_pixels', 0) for r in processing_results)
        unique_regions = len(set(r.get('imageId', '').split('_')[0] for r in processing_results if r.get('imageId')))
        
        sensitivity_metrics['spatial_detection_capability'] = {
            'total_pixels_analyzed': total_pixels,
            'unique_regions_analyzed': unique_regions,
            'average_pixels_per_region': total_pixels / unique_regions if unique_regions > 0 else 0,
            'multi_region_detection': unique_regions > 1,
            'spatial_coherence_score': confidence_scores.get('spatial_coherence_confidence', 0)
        }
        
        # Analyze model reuse impact on sensitivity
        model_reused_count = sum(1 for r in processing_results if r.get('model_reused', False))
        total_images = len(processing_results)
        
        sensitivity_metrics['model_reuse_impact'] = {
            'model_reuse_rate': (model_reused_count / total_images) * 100 if total_images > 0 else 0,
            'historical_consistency_benefit': confidence_scores.get('historical_consistency_confidence', 0),
            'incremental_learning_active': model_reused_count > 0,
            'detection_consistency': 'improved' if model_reused_count > 0 else 'baseline'
        }
        
        return sensitivity_metrics
        
    except Exception as e:
        logger.error(f"❌ Detection sensitivity assessment failed: {str(e)}")
        return {'error': f'Sensitivity analysis failed: {str(e)}'}

def evaluate_false_positive_risk(statistics: Dict[str, float], risk_assessment: Dict[str, Any], 
                                confidence_scores: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluate the risk of false positive alerts
    """
    
    false_positive_indicators = {
        'risk_level': 'LOW',
        'risk_factors': [],
        'protective_factors': [],
        'confidence_correlation': {},
        'spatial_analysis': {}
    }
    
    try:
        # Analyze confidence correlation with alert level
        overall_confidence = confidence_scores.get('overall_confidence', 0)
        alert_level = risk_assessment.get('level', 'INFO')
        
        false_positive_indicators['confidence_correlation'] = {
            'alert_level': alert_level,
            'confidence_score': overall_confidence,
            'confidence_alert_alignment': categorize_confidence_alert_alignment(alert_level, overall_confidence)
        }
        
        # High-risk false positive indicators
        if alert_level == 'HIGH' and overall_confidence < 0.6:
            false_positive_indicators['risk_factors'].append('High alert with low confidence - potential false positive')
            false_positive_indicators['risk_level'] = 'HIGH'
        
        if statistics.get('avg_vegetation_coverage', 0) > 70 and alert_level != 'INFO':
            false_positive_indicators['risk_factors'].append('High vegetation coverage with deforestation alert - needs verification')
            false_positive_indicators['risk_level'] = 'MEDIUM'
        
        # Spatial analysis for false positive detection
        spatial_coherence = confidence_scores.get('spatial_coherence_confidence', 0)
        false_positive_indicators['spatial_analysis'] = {
            'spatial_coherence_score': spatial_coherence,
            'variance_analysis': statistics.get('std_vegetation_coverage', 0),
            'isolated_anomaly_risk': 'HIGH' if spatial_coherence < 0.4 else 'LOW'
        }
        
        if spatial_coherence < 0.4:
            false_positive_indicators['risk_factors'].append('Low spatial coherence - possible isolated false detection')
        
        # Protective factors against false positives
        if confidence_scores.get('historical_consistency_confidence', 0) > 0.8:
            false_positive_indicators['protective_factors'].append('High historical consistency reduces false positive risk')
        
        if confidence_scores.get('data_quality_confidence', 0) > 0.9:
            false_positive_indicators['protective_factors'].append('Excellent data quality reduces false positive risk')
        
        model_analysis = risk_assessment.get('model_analysis', {})
        if model_analysis.get('model_efficiency', 0) > 80:
            false_positive_indicators['protective_factors'].append('High model reuse efficiency indicates stable detection')
        
        # Multi-region analysis reduces false positive risk
        unique_tiles = len(model_analysis.get('unique_tiles', []))
        if unique_tiles > 1:
            false_positive_indicators['protective_factors'].append(f'Multi-region analysis ({unique_tiles} regions) increases reliability')
        
        # Final risk assessment
        if len(false_positive_indicators['risk_factors']) == 0 and len(false_positive_indicators['protective_factors']) > 2:
            false_positive_indicators['risk_level'] = 'LOW'
        elif len(false_positive_indicators['risk_factors']) > len(false_positive_indicators['protective_factors']):
            false_positive_indicators['risk_level'] = 'HIGH'
        else:
            false_positive_indicators['risk_level'] = 'MEDIUM'
        
        return false_positive_indicators
        
    except Exception as e:
        logger.error(f"❌ False positive evaluation failed: {str(e)}")
        return {
            'risk_level': 'UNKNOWN',
            'error': f'False positive analysis failed: {str(e)}'
        }

def categorize_confidence_alert_alignment(alert_level: str, confidence_score: float) -> str:
    """Categorize the alignment between alert level and confidence score"""
    
    if alert_level == 'HIGH':
        if confidence_score > 0.8:
            return 'WELL_ALIGNED'  # High alert, high confidence
        elif confidence_score > 0.6:
            return 'MODERATELY_ALIGNED'  # High alert, medium confidence
        else:
            return 'MISALIGNED'  # High alert, low confidence - potential false positive
    
    elif alert_level == 'MEDIUM':
        if 0.5 <= confidence_score <= 0.8:
            return 'WELL_ALIGNED'  # Medium alert, medium confidence
        else:
            return 'MODERATELY_ALIGNED'
    
    else:  # INFO level
        if confidence_score < 0.7:
            return 'WELL_ALIGNED'  # Low alert, lower confidence is expected
        else:
            return 'MODERATELY_ALIGNED'

def calculate_overall_quality_score(threshold_comparison: Dict[str, Any], temporal_accuracy: Dict[str, Any], 
                                  detection_sensitivity: Dict[str, Any], false_positive_indicators: Dict[str, Any]) -> Dict[str, Any]:
    """
    Calculate an overall quality score combining all quality metrics
    """
    
    try:
        quality_components = {
            'temporal_score': 0.0,
            'sensitivity_score': 0.0,
            'false_positive_score': 0.0,
            'threshold_improvement_score': 0.0
        }
        
        quality_factors = []
        
        # 1. Temporal accuracy score
        temporal_analysis = temporal_accuracy.get('temporal_coverage_analysis', {})
        if temporal_analysis:
            real_time_percentage = temporal_analysis.get('real_time_processing_percentage', 0)
            avg_delay = temporal_analysis.get('average_detection_delay_hours', 168)  # Default 1 week
            
            # Score based on processing speed (0-1 scale)
            temporal_score = min(1.0, (real_time_percentage / 100.0) + (max(0, 168 - avg_delay) / 168.0) * 0.5)
            quality_components['temporal_score'] = temporal_score
            
            if real_time_percentage > 80:
                quality_factors.append(f'Excellent temporal accuracy ({real_time_percentage:.1f}% real-time)')
            elif real_time_percentage > 50:
                quality_factors.append(f'Good temporal accuracy ({real_time_percentage:.1f}% real-time)')
            else:
                quality_factors.append(f'Moderate temporal accuracy ({real_time_percentage:.1f}% real-time)')
        
        # 2. Detection sensitivity score
        sensitivity_spatial = detection_sensitivity.get('spatial_detection_capability', {})
        if sensitivity_spatial:
            multi_region = sensitivity_spatial.get('multi_region_detection', False)
            coherence_score = sensitivity_spatial.get('spatial_coherence_score', 0.5)
            
            sensitivity_score = coherence_score * (1.2 if multi_region else 1.0)  # Bonus for multi-region
            quality_components['sensitivity_score'] = min(1.0, sensitivity_score)
            
            if sensitivity_score > 0.8:
                quality_factors.append('High detection sensitivity with good spatial coherence')
            elif sensitivity_score > 0.6:
                quality_factors.append('Moderate detection sensitivity')
            else:
                quality_factors.append('Basic detection sensitivity')
        
        # 3. False positive risk score (inverted - lower risk = higher score)
        fp_risk = false_positive_indicators.get('risk_level', 'MEDIUM')
        protective_factors_count = len(false_positive_indicators.get('protective_factors', []))
        risk_factors_count = len(false_positive_indicators.get('risk_factors', []))
        
        if fp_risk == 'LOW':
            fp_score = 0.9 + (protective_factors_count * 0.02)  # Up to 1.0
        elif fp_risk == 'MEDIUM':
            fp_score = 0.7 - (risk_factors_count * 0.1)
        else:  # HIGH
            fp_score = 0.4 - (risk_factors_count * 0.1)
        
        quality_components['false_positive_score'] = max(0.0, min(1.0, fp_score))
        
        if fp_risk == 'LOW':
            quality_factors.append('Low false positive risk')
        elif fp_risk == 'MEDIUM':
            quality_factors.append('Moderate false positive risk')
        else:
            quality_factors.append('High false positive risk - needs validation')
        
        # 4. Threshold system improvement score
        improvement_indicators = threshold_comparison.get('improvement_indicators', [])
        threshold_improvement_score = min(1.0, len(improvement_indicators) * 0.3 + 0.4)  # Base score + improvements
        quality_components['threshold_improvement_score'] = threshold_improvement_score
        
        if len(improvement_indicators) > 0:
            quality_factors.append('Clustering shows improvements over threshold-based detection')
        
        # Calculate weighted overall score
        weights = {
            'temporal': 0.25,
            'sensitivity': 0.30,
            'false_positive': 0.30,
            'threshold_improvement': 0.15
        }
        
        overall_score = (
            quality_components['temporal_score'] * weights['temporal'] +
            quality_components['sensitivity_score'] * weights['sensitivity'] +
            quality_components['false_positive_score'] * weights['false_positive'] +
            quality_components['threshold_improvement_score'] * weights['threshold_improvement']
        )
        
        return {
            'score': overall_score,
            'components': quality_components,
            'factors': quality_factors,
            'grade': categorize_quality_score(overall_score)
        }
        
    except Exception as e:
        logger.error(f"❌ Overall quality score calculation failed: {str(e)}")
        return {
            'score': 0.0,
            'components': {},
            'factors': ['Quality score calculation failed'],
            'grade': 'F'
        }

def categorize_quality_score(score: float) -> str:
    """Convert numeric quality score to letter grade"""
    if score >= 0.9:
        return 'A+'
    elif score >= 0.85:
        return 'A'
    elif score >= 0.8:
        return 'A-'
    elif score >= 0.75:
        return 'B+'
    elif score >= 0.7:
        return 'B'
    elif score >= 0.65:
        return 'B-'
    elif score >= 0.6:
        return 'C+'
    elif score >= 0.55:
        return 'C'
    elif score >= 0.5:
        return 'C-'
    elif score >= 0.4:
        return 'D'
    else:
        return 'F'

def store_alert_quality_metrics(s3_client, quality_metrics: Dict[str, Any], processing_results: List[Dict[str, Any]]) -> None:
    """
    Store alert quality metrics to S3 for historical tracking and analysis
    """
    
    try:
        # Group by tile_id for organized storage
        tile_groups = {}
        for result in processing_results:
            image_id = result.get('imageId', '')
            if image_id:
                tile_id = image_id.split('_')[0]
                if tile_id not in tile_groups:
                    tile_groups[tile_id] = []
                tile_groups[tile_id].append(result)
        
        # Store metrics for each tile
        for tile_id in tile_groups.keys():
            timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
            s3_key = f'alert-quality-metrics/{tile_id}/quality_{timestamp}.json'
            
            # Prepare tile-specific quality data
            tile_quality_data = {
                'tile_id': tile_id,
                'timestamp': quality_metrics['timestamp'],
                'quality_metrics': quality_metrics,
                'processing_results_count': len(tile_groups[tile_id]),
                'system_version': 'clustering_based_v1.0'
            }
            
            # Upload to S3
            s3_client.put_object(
                Bucket=PROCESSED_DATA_BUCKET,
                Key=s3_key,
                Body=json.dumps(tile_quality_data, indent=2),
                ContentType='application/json'
            )
        
        # Store aggregate quality metrics
        aggregate_s3_key = f'alert-quality-metrics/aggregate/quality_{datetime.utcnow().strftime("%Y%m%d_%H%M%S")}.json'
        aggregate_data = {
            'timestamp': quality_metrics['timestamp'],
            'tiles_analyzed': list(tile_groups.keys()),
            'total_tiles': len(tile_groups),
            'aggregate_quality_metrics': quality_metrics,
            'system_version': 'clustering_based_v1.0'
        }
        
        s3_client.put_object(
            Bucket=PROCESSED_DATA_BUCKET,
            Key=aggregate_s3_key,
            Body=json.dumps(aggregate_data, indent=2),
            ContentType='application/json'
        )
        
        logger.info(f"📊 Quality metrics stored for {len(tile_groups)} tiles")
        
    except Exception as e:
        logger.warning(f"⚠️ Failed to store quality metrics to S3 (non-critical): {str(e)}") 