import json
import logging
import boto3
import numpy as np
import matplotlib
matplotlib.use('Agg')  # Use non-interactive backend for Lambda
import matplotlib.pyplot as plt
import seaborn as sns
from io import BytesIO
import base64
from datetime import datetime
from typing import Dict, Any, List, Tuple
import pandas as pd

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize AWS clients
s3 = boto3.client('s3')

# Environment variables
PROCESSED_DATA_BUCKET = 'forestshield-processed-data-381492060635'
VISUALIZATION_PREFIX = 'visualizations'

def lambda_handler(event, context):
    """
    K-means Visualization Generator
    
    Generates beautiful plots of clustering results and saves them to S3.
    
    Expected event structure:
    {
        "mode": "generate-cluster-plots",
        "tile_id": "S2B", 
        "pixel_data_path": "s3://bucket/path/to/pixel_data.json",
        "sagemaker_results_path": "s3://bucket/path/to/clustering_results.json",
        "model_metadata": {...}
    }
    """
    
    try:
        logger.info("Starting K-means visualization generation")
        
        mode = event.get('mode', 'generate-cluster-plots')
        
        if mode == 'generate-cluster-plots':
            return generate_cluster_visualizations(event)
        else:
            raise ValueError(f"Invalid mode: '{mode}'. Expected 'generate-cluster-plots'.")
            
    except Exception as e:
        logger.error(f"❌ Visualization generation failed: {str(e)}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e)
            })
        }

def generate_cluster_visualizations(event):
    """
    Generate comprehensive K-means clustering visualizations
    """
    
    tile_id = event.get('tile_id')
    pixel_data_path = event.get('pixel_data_path')
    sagemaker_results_path = event.get('sagemaker_results_path')
    model_metadata = event.get('model_metadata', {})
    
    if not all([tile_id, pixel_data_path]):
        raise ValueError("Missing required parameters: tile_id, pixel_data_path")
    
    logger.info(f"🎨 Generating visualizations for tile: {tile_id}")
    logger.info(f"   Pixel data: {pixel_data_path}")
    logger.info(f"   SageMaker results: {sagemaker_results_path}")
    
    try:
        # 1. Load pixel data and clustering results
        pixel_data = load_pixel_data_from_s3(pixel_data_path)
        cluster_assignments = load_cluster_results_from_s3(sagemaker_results_path) if sagemaker_results_path else None
        
        if not pixel_data:
            logger.error(f"❌ No pixel data loaded from {pixel_data_path}")
            raise ValueError(f"Failed to load pixel data from {pixel_data_path}")
        
        logger.info(f"📊 Loaded {len(pixel_data)} pixels for visualization")
        if cluster_assignments:
            logger.info(f"🎯 Found {len(set(cluster_assignments))} clusters")
        else:
            logger.info("⚠️ No cluster assignments found - generating visualizations without clustering")
        
        # 2. Create timestamp for organized storage
        timestamp = datetime.utcnow().strftime('%Y%m%d-%H%M%S')
        viz_prefix = f"{VISUALIZATION_PREFIX}/{tile_id}/{timestamp}"
        
        # 3. Generate different types of visualizations
        visualization_urls = {}
        
        # Plot 1: NDVI vs Red Band Scatter Plot (with or without clusters)
        viz_urls = create_ndvi_red_cluster_plot(pixel_data, cluster_assignments, viz_prefix, tile_id)
        visualization_urls.update(viz_urls)
        
        # Plot 2: Geographic Distribution of Pixels (with or without clusters)
        geo_urls = create_geographic_distribution_plot(pixel_data, cluster_assignments, viz_prefix, tile_id)
        visualization_urls.update(geo_urls)
        
        # Plot 3: Feature Distribution Histograms (always generate)
        hist_urls = create_feature_distribution_plots(pixel_data, viz_prefix, tile_id)
        visualization_urls.update(hist_urls)
        
        # Plot 4: Cluster Statistics Summary (only if clusters available)
        if cluster_assignments:
            stats_urls = create_cluster_statistics_plot(pixel_data, cluster_assignments, viz_prefix, tile_id)
            visualization_urls.update(stats_urls)
        
        # Plot 5: NDVI vs NIR Scatter Plot (with or without clusters)
        ndvi_nir_urls = create_ndvi_nir_plot(pixel_data, cluster_assignments, viz_prefix, tile_id)
        visualization_urls.update(ndvi_nir_urls)
        
        logger.info(f"✅ Generated {len(visualization_urls)} visualizations for {tile_id}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'status': 'success',
                'tile_id': tile_id,
                'timestamp': timestamp,
                'visualizations': visualization_urls,
                'visualization_count': len(visualization_urls),
                'pixel_count': len(pixel_data) if pixel_data else 0,
                'cluster_count': len(set(cluster_assignments)) if cluster_assignments else 0
            })
        }
        
    except Exception as e:
        logger.error(f"❌ Failed to generate visualizations: {str(e)}")
        raise

def load_pixel_data_from_s3(s3_path):
    """Load pixel data from S3 path - handles both JSON and CSV formats"""
    try:
        bucket_name = s3_path.split('/')[2]
        key = '/'.join(s3_path.split('/')[3:])
        
        response = s3.get_object(Bucket=bucket_name, Key=key)
        
        # Check if it's a CSV file
        if s3_path.endswith('.csv'):
            logger.info(f"📊 Loading CSV pixel data from {s3_path}")
            import csv
            import io
            
            csv_content = response['Body'].read().decode('utf-8')
            csv_reader = csv.reader(io.StringIO(csv_content))
            
            pixel_data = []
            for row_num, row in enumerate(csv_reader):
                if len(row) >= 5:  # Expecting 5 features: ndvi, red, nir, lat, lng
                    try:
                        pixel = [float(val) for val in row[:5]]
                        pixel_data.append(pixel)
                    except ValueError as ve:
                        if row_num == 0:  # Skip header row if present
                            continue
                        logger.warning(f"⚠️ Skipping invalid row {row_num}: {row}")
                        
            logger.info(f"✅ Loaded {len(pixel_data)} pixels from CSV")
            return pixel_data
            
        else:
            # Try to load as JSON
            logger.info(f"📊 Loading JSON pixel data from {s3_path}")
            data = json.loads(response['Body'].read().decode('utf-8'))
            
            # Extract pixel features: [ndvi, red, nir, lat, lng]
            if 'pixel_data' in data:
                return data['pixel_data']
            elif isinstance(data, list):
                return data
            else:
                logger.warning(f"⚠️ Unexpected JSON data format in {s3_path}")
                return []
            
    except Exception as e:
        logger.error(f"❌ Failed to load pixel data from {s3_path}: {str(e)}")
        return []

def load_cluster_results_from_s3(s3_path):
    """Load SageMaker clustering results from S3"""
    if not s3_path:
        return None
        
    try:
        bucket_name = s3_path.split('/')[2]
        key = '/'.join(s3_path.split('/')[3:])
        
        # Check if it's a tar.gz file (SageMaker model output)
        if s3_path.endswith('.tar.gz') or s3_path.endswith('.tgz'):
            logger.warning(f"⚠️ Cannot directly load cluster assignments from compressed model file: {s3_path}")
            logger.info("💡 SageMaker model.tar.gz contains the trained model, not cluster assignments")
            logger.info("💡 To get cluster assignments, you would need to run inference on the pixel data")
            logger.info("💡 Proceeding to generate visualizations without cluster assignments")
            return None
        
        # Try to load JSON cluster assignments
        response = s3.get_object(Bucket=bucket_name, Key=key)
        data = json.loads(response['Body'].read().decode('utf-8'))
        
        # Extract cluster assignments
        if 'cluster_assignments' in data:
            return data['cluster_assignments']
        elif 'predictions' in data:
            return data['predictions']
        else:
            logger.warning(f"⚠️ No cluster assignments found in {s3_path}")
            return None
            
    except Exception as e:
        logger.warning(f"⚠️ Failed to load cluster results from {s3_path}: {str(e)}")
        return None

def create_ndvi_red_cluster_plot(pixel_data, cluster_assignments, viz_prefix, tile_id):
    """Create NDVI vs Red band scatter plot with cluster colors"""
    
    try:
        # Extract features
        ndvi_values = [pixel[0] for pixel in pixel_data]
        red_values = [pixel[1] for pixel in pixel_data]
        
        # Create DataFrame for easier plotting
        df = pd.DataFrame({
            'NDVI': ndvi_values,
            'Red_Band': red_values,
            'Cluster': cluster_assignments if cluster_assignments else [0] * len(pixel_data)
        })
        
        # Create the plot
        plt.figure(figsize=(12, 8))
        
        if cluster_assignments:
            # Plot with cluster colors
            unique_clusters = sorted(df['Cluster'].unique())
            colors = plt.cm.Set1(np.linspace(0, 1, len(unique_clusters)))
            
            for i, cluster in enumerate(unique_clusters):
                cluster_data = df[df['Cluster'] == cluster]
                plt.scatter(cluster_data['NDVI'], cluster_data['Red_Band'], 
                           c=[colors[i]], label=f'Cluster {cluster}', alpha=0.6, s=20)
        else:
            # Plot without clusters
            plt.scatter(df['NDVI'], df['Red_Band'], alpha=0.6, s=20, c='blue')
        
        plt.xlabel('NDVI (Normalized Difference Vegetation Index)', fontsize=12)
        plt.ylabel('Red Band Reflectance', fontsize=12)
        if cluster_assignments:
            plt.title(f'K-means Clustering: NDVI vs Red Band\nTile: {tile_id} | Pixels: {len(pixel_data):,}', fontsize=14)
        else:
            plt.title(f'NDVI vs Red Band Distribution\nTile: {tile_id} | Pixels: {len(pixel_data):,}', fontsize=14)
        
        if cluster_assignments:
            plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
        
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        # Save to S3
        plot_key = f"{viz_prefix}/ndvi_red_clusters.png"
        plot_url = save_plot_to_s3(plt, plot_key)
        plt.close()
        
        return {'ndvi_red_clusters': plot_url}
        
    except Exception as e:
        logger.error(f"❌ Failed to create NDVI-Red cluster plot: {str(e)}")
        return {}

def create_geographic_distribution_plot(pixel_data, cluster_assignments, viz_prefix, tile_id):
    """Create geographic distribution plot of pixels"""
    
    try:
        # Extract coordinates
        latitudes = [pixel[3] for pixel in pixel_data]
        longitudes = [pixel[4] for pixel in pixel_data]
        
        # Create DataFrame
        df = pd.DataFrame({
            'Latitude': latitudes,
            'Longitude': longitudes,
            'Cluster': cluster_assignments if cluster_assignments else [0] * len(pixel_data)
        })
        
        # Create the plot
        plt.figure(figsize=(12, 10))
        
        if cluster_assignments:
            # Plot with cluster colors
            unique_clusters = sorted(df['Cluster'].unique())
            colors = plt.cm.Set1(np.linspace(0, 1, len(unique_clusters)))
            
            for i, cluster in enumerate(unique_clusters):
                cluster_data = df[df['Cluster'] == cluster]
                plt.scatter(cluster_data['Longitude'], cluster_data['Latitude'], 
                           c=[colors[i]], label=f'Cluster {cluster}', alpha=0.7, s=15)
        else:
            plt.scatter(df['Longitude'], df['Latitude'], alpha=0.7, s=15, c='green')
        
        plt.xlabel('Longitude', fontsize=12)
        plt.ylabel('Latitude', fontsize=12)
        if cluster_assignments:
            plt.title(f'Geographic Distribution by Cluster\nTile: {tile_id} | Pixels: {len(pixel_data):,}', fontsize=14)
        else:
            plt.title(f'Geographic Distribution of Analyzed Pixels\nTile: {tile_id} | Pixels: {len(pixel_data):,}', fontsize=14)
        
        if cluster_assignments:
            plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
        
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        # Save to S3
        plot_key = f"{viz_prefix}/geographic_distribution.png"
        plot_url = save_plot_to_s3(plt, plot_key)
        plt.close()
        
        return {'geographic_distribution': plot_url}
        
    except Exception as e:
        logger.error(f"❌ Failed to create geographic distribution plot: {str(e)}")
        return {}

def create_feature_distribution_plots(pixel_data, viz_prefix, tile_id):
    """Create histograms of feature distributions"""
    
    try:
        # Extract all features
        ndvi_values = [pixel[0] for pixel in pixel_data]
        red_values = [pixel[1] for pixel in pixel_data]
        nir_values = [pixel[2] for pixel in pixel_data]
        
        # Create subplots
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        fig.suptitle(f'Feature Distributions - Tile: {tile_id}', fontsize=16)
        
        # NDVI histogram
        axes[0, 0].hist(ndvi_values, bins=50, alpha=0.7, color='green', edgecolor='black')
        axes[0, 0].set_title('NDVI Distribution')
        axes[0, 0].set_xlabel('NDVI')
        axes[0, 0].set_ylabel('Frequency')
        axes[0, 0].grid(True, alpha=0.3)
        
        # Red band histogram
        axes[0, 1].hist(red_values, bins=50, alpha=0.7, color='red', edgecolor='black')
        axes[0, 1].set_title('Red Band Distribution')
        axes[0, 1].set_xlabel('Red Band Reflectance')
        axes[0, 1].set_ylabel('Frequency')
        axes[0, 1].grid(True, alpha=0.3)
        
        # NIR band histogram
        axes[1, 0].hist(nir_values, bins=50, alpha=0.7, color='darkred', edgecolor='black')
        axes[1, 0].set_title('NIR Band Distribution')
        axes[1, 0].set_xlabel('NIR Band Reflectance')
        axes[1, 0].set_ylabel('Frequency')
        axes[1, 0].grid(True, alpha=0.3)
        
        # Summary statistics
        axes[1, 1].axis('off')
        stats_text = f"""
        Summary Statistics:
        
        NDVI:  Mean={np.mean(ndvi_values):.3f}, Std={np.std(ndvi_values):.3f}
        Red:   Mean={np.mean(red_values):.1f}, Std={np.std(red_values):.1f}
        NIR:   Mean={np.mean(nir_values):.1f}, Std={np.std(nir_values):.1f}
        
        Total Pixels: {len(pixel_data):,}
        NDVI Range: {np.min(ndvi_values):.3f} to {np.max(ndvi_values):.3f}
        """
        axes[1, 1].text(0.1, 0.5, stats_text, fontsize=12, verticalalignment='center')
        
        plt.tight_layout()
        
        # Save to S3
        plot_key = f"{viz_prefix}/feature_distributions.png"
        plot_url = save_plot_to_s3(plt, plot_key)
        plt.close()
        
        return {'feature_distributions': plot_url}
        
    except Exception as e:
        logger.error(f"❌ Failed to create feature distribution plots: {str(e)}")
        return {}

def create_cluster_statistics_plot(pixel_data, cluster_assignments, viz_prefix, tile_id):
    """Create cluster statistics visualization"""
    
    try:
        # Create DataFrame
        df = pd.DataFrame({
            'NDVI': [pixel[0] for pixel in pixel_data],
            'Red': [pixel[1] for pixel in pixel_data],
            'NIR': [pixel[2] for pixel in pixel_data],
            'Cluster': cluster_assignments
        })
        
        # Calculate cluster statistics
        cluster_stats = df.groupby('Cluster').agg({
            'NDVI': ['mean', 'std', 'count'],
            'Red': ['mean', 'std'],
            'NIR': ['mean', 'std']
        }).round(3)
        
        # Create subplots
        fig, axes = plt.subplots(2, 2, figsize=(15, 10))
        fig.suptitle(f'Cluster Statistics - Tile: {tile_id}', fontsize=16)
        
        # Cluster sizes
        cluster_counts = df['Cluster'].value_counts().sort_index()
        axes[0, 0].bar(cluster_counts.index, cluster_counts.values, alpha=0.7, color='skyblue')
        axes[0, 0].set_title('Cluster Sizes')
        axes[0, 0].set_xlabel('Cluster ID')
        axes[0, 0].set_ylabel('Number of Pixels')
        axes[0, 0].grid(True, alpha=0.3)
        
        # Mean NDVI by cluster
        mean_ndvi = df.groupby('Cluster')['NDVI'].mean()
        axes[0, 1].bar(mean_ndvi.index, mean_ndvi.values, alpha=0.7, color='green')
        axes[0, 1].set_title('Mean NDVI by Cluster')
        axes[0, 1].set_xlabel('Cluster ID')
        axes[0, 1].set_ylabel('Mean NDVI')
        axes[0, 1].grid(True, alpha=0.3)
        
        # Box plot of NDVI by cluster
        df.boxplot(column='NDVI', by='Cluster', ax=axes[1, 0])
        axes[1, 0].set_title('NDVI Distribution by Cluster')
        axes[1, 0].set_xlabel('Cluster ID')
        axes[1, 0].set_ylabel('NDVI')
        
        # Cluster statistics table
        axes[1, 1].axis('off')
        table_text = "Cluster Statistics:\n\n"
        for cluster in sorted(df['Cluster'].unique()):
            cluster_data = df[df['Cluster'] == cluster]
            table_text += f"Cluster {cluster}:\n"
            table_text += f"  Size: {len(cluster_data):,} pixels\n"
            table_text += f"  NDVI: {cluster_data['NDVI'].mean():.3f} ± {cluster_data['NDVI'].std():.3f}\n"
            table_text += f"  Red: {cluster_data['Red'].mean():.1f} ± {cluster_data['Red'].std():.1f}\n"
            table_text += f"  NIR: {cluster_data['NIR'].mean():.1f} ± {cluster_data['NIR'].std():.1f}\n\n"
        
        axes[1, 1].text(0.1, 0.9, table_text, fontsize=10, verticalalignment='top', fontfamily='monospace')
        
        plt.tight_layout()
        
        # Save to S3
        plot_key = f"{viz_prefix}/cluster_statistics.png"
        plot_url = save_plot_to_s3(plt, plot_key)
        plt.close()
        
        return {'cluster_statistics': plot_url}
        
    except Exception as e:
        logger.error(f"❌ Failed to create cluster statistics plot: {str(e)}")
        return {}

def create_ndvi_nir_plot(pixel_data, cluster_assignments, viz_prefix, tile_id):
    """Create NDVI vs NIR scatter plot"""
    
    try:
        # Extract features
        ndvi_values = [pixel[0] for pixel in pixel_data]
        nir_values = [pixel[2] for pixel in pixel_data]
        
        # Create DataFrame
        df = pd.DataFrame({
            'NDVI': ndvi_values,
            'NIR_Band': nir_values,
            'Cluster': cluster_assignments if cluster_assignments else [0] * len(pixel_data)
        })
        
        # Create the plot
        plt.figure(figsize=(12, 8))
        
        if cluster_assignments:
            # Plot with cluster colors
            unique_clusters = sorted(df['Cluster'].unique())
            colors = plt.cm.Set1(np.linspace(0, 1, len(unique_clusters)))
            
            for i, cluster in enumerate(unique_clusters):
                cluster_data = df[df['Cluster'] == cluster]
                plt.scatter(cluster_data['NDVI'], cluster_data['NIR_Band'], 
                           c=[colors[i]], label=f'Cluster {cluster}', alpha=0.6, s=20)
        else:
            plt.scatter(df['NDVI'], df['NIR_Band'], alpha=0.6, s=20, c='darkred')
        
        plt.xlabel('NDVI (Normalized Difference Vegetation Index)', fontsize=12)
        plt.ylabel('NIR Band Reflectance', fontsize=12)
        if cluster_assignments:
            plt.title(f'K-means Clustering: NDVI vs NIR Band\nTile: {tile_id} | Pixels: {len(pixel_data):,}', fontsize=14)
        else:
            plt.title(f'NDVI vs NIR Band Distribution\nTile: {tile_id} | Pixels: {len(pixel_data):,}', fontsize=14)
        
        if cluster_assignments:
            plt.legend(bbox_to_anchor=(1.05, 1), loc='upper left')
        
        plt.grid(True, alpha=0.3)
        plt.tight_layout()
        
        # Save to S3
        plot_key = f"{viz_prefix}/ndvi_nir_clusters.png"
        plot_url = save_plot_to_s3(plt, plot_key)
        plt.close()
        
        return {'ndvi_nir_clusters': plot_url}
        
    except Exception as e:
        logger.error(f"❌ Failed to create NDVI-NIR plot: {str(e)}")
        return {}

def save_plot_to_s3(plt_figure, s3_key):
    """Save matplotlib plot to S3 and return public URL"""
    
    try:
        # Save plot to BytesIO buffer
        buffer = BytesIO()
        plt_figure.savefig(buffer, format='png', dpi=300, bbox_inches='tight')
        buffer.seek(0)
        
        # Upload to S3 (without ACL since bucket doesn't support ACLs)
        s3.put_object(
            Bucket=PROCESSED_DATA_BUCKET,
            Key=s3_key,
            Body=buffer.getvalue(),
            ContentType='image/png'
        )
        
        # Return S3 path (API will generate signed URLs as needed)
        s3_path = f"s3://{PROCESSED_DATA_BUCKET}/{s3_key}"
        logger.info(f"📊 Saved visualization: {s3_path}")
        
        return s3_path
        
    except Exception as e:
        logger.error(f"❌ Failed to save plot to S3: {str(e)}")
        return None 