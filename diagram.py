#!/usr/bin/env python3
"""
ForestShield Technical Architecture Diagrams Generator
Generates three strategic diagrams using Graphviz to visualize the system architecture.
"""

import graphviz
import os
from datetime import datetime

def create_ml_pipeline_diagram():
    """
    Diagram 1: Machine Learning Pipeline & Data Flow
    Shows the complete ML workflow from satellite data to model deployment
    """
    dot = graphviz.Digraph(
        name='forestshield_ml_pipeline',
        comment='ForestShield ML Pipeline & Data Flow',
        format='png'
    )
    
    # Configure graph attributes
    dot.attr(rankdir='TB', size='16,12', dpi='300')
    dot.attr('node', fontname='Arial', fontsize='10')
    dot.attr('edge', fontname='Arial', fontsize='8')
    
    # Define color scheme
    colors = {
        'data_source': '#E8F4FD',      # Light blue
        'lambda': '#FFE6CC',           # Light orange
        'ml_service': '#D4E6F1',       # Light purple
        'storage': '#D5F4E6',          # Light green
        'visualization': '#FCF3CF'     # Light yellow
    }
    
    # Data Sources
    with dot.subgraph(name='cluster_data_sources') as c:
        c.attr(label='Data Sources', style='filled', color='lightgrey')
        c.node('sentinel2', 'Sentinel-2\nSatellite Data\n(STAC API)', 
               shape='cylinder', fillcolor=colors['data_source'], style='filled')
        c.node('copernicus', 'Copernicus\nOpen Access Hub', 
               shape='cylinder', fillcolor=colors['data_source'], style='filled')
    
    # Lambda Functions
    with dot.subgraph(name='cluster_lambdas') as c:
        c.attr(label='Lambda Functions (Serverless Processing)', style='filled', color='lightgrey')
        c.node('search_images', 'SearchImages\n(Java + SnapStart)\n\n• Query STAC API\n• Filter by cloud cover\n• Geographic bounds', 
               shape='box', fillcolor=colors['lambda'], style='filled')
        c.node('vegetation_analyzer', 'VegetationAnalyzer\n(Python + GDAL)\n\n• Download Red/NIR bands\n• Calculate NDVI\n• Generate training data', 
               shape='box', fillcolor=colors['lambda'], style='filled')
        c.node('k_selector', 'K-Selector\n(Python)\n\n• Elbow Method\n• Parallel SageMaker jobs\n• Optimal K selection', 
               shape='box', fillcolor=colors['lambda'], style='filled')
        c.node('model_manager', 'ModelManager\n(Python)\n\n• Model versioning\n• Region-specific storage\n• Performance tracking', 
               shape='box', fillcolor=colors['lambda'], style='filled')
        c.node('viz_generator', 'VisualizationGenerator\n(Python)\n\n• Cluster plots\n• NDVI distributions\n• Geographic overlays', 
               shape='box', fillcolor=colors['lambda'], style='filled')
        c.node('results_consolidator', 'ResultsConsolidator\n(Python)\n\n• PDF reports\n• Confidence scoring\n• Risk assessment', 
               shape='box', fillcolor=colors['lambda'], style='filled')
    
    # ML Services
    with dot.subgraph(name='cluster_ml') as c:
        c.attr(label='Machine Learning Services', style='filled', color='lightgrey')
        c.node('sagemaker_kmeans', 'SageMaker\nK-Means Clustering\n\n• ml.m5.large instances\n• 5-dimensional features\n• Automated training', 
               shape='ellipse', fillcolor=colors['ml_service'], style='filled')
        c.node('sagemaker_processor', 'SageMaker\nProcessor\n(Java)\n\n• Data preprocessing\n• Feature engineering\n• Batch inference', 
               shape='ellipse', fillcolor=colors['ml_service'], style='filled')
    
    # Storage Systems
    with dot.subgraph(name='cluster_storage') as c:
        c.attr(label='Storage & Data Management', style='filled', color='lightgrey')
        c.node('s3_processed', 'S3: Processed Data\n\n• NDVI rasters\n• Training datasets\n• Pixel-level data', 
               shape='folder', fillcolor=colors['storage'], style='filled')
        c.node('s3_models', 'S3: ML Models\n\n• Region-specific models\n• Version history\n• Performance metrics', 
               shape='folder', fillcolor=colors['storage'], style='filled')
        c.node('s3_visualizations', 'S3: Visualizations\n\n• Cluster plots\n• NDVI maps\n• Analysis reports', 
               shape='folder', fillcolor=colors['storage'], style='filled')
    
    # Mathematical Formulas (as notes)
    dot.node('ndvi_formula', 'NDVI = (NIR - Red) / (NIR + Red)\n\nElbow Method:\nSSE = Σ(xi - ci)²\n\nOptimal K = argmin(SSE gradient)', 
             shape='note', fillcolor='white', style='filled')
    
    # Data Flow Connections
    dot.edge('sentinel2', 'search_images', label='STAC Query')
    dot.edge('copernicus', 'search_images', label='Metadata')
    dot.edge('search_images', 'vegetation_analyzer', label='Image URLs')
    dot.edge('vegetation_analyzer', 's3_processed', label='NDVI Data')
    dot.edge('vegetation_analyzer', 'model_manager', label='Check Existing Model')
    
    # Model Decision Flow
    dot.edge('model_manager', 'k_selector', label='No Model Found', style='dashed')
    dot.edge('model_manager', 'viz_generator', label='Model Exists', color='green')
    
    # Training Pipeline
    dot.edge('k_selector', 'sagemaker_kmeans', label='K Values (2-10)')
    dot.edge('s3_processed', 'sagemaker_kmeans', label='Training Data')
    dot.edge('sagemaker_kmeans', 's3_models', label='Model Artifacts')
    dot.edge('s3_models', 'model_manager', label='Save Model')
    
    # Visualization Pipeline
    dot.edge('sagemaker_kmeans', 'viz_generator', label='Cluster Results')
    dot.edge('viz_generator', 's3_visualizations', label='Plots & Charts')
    dot.edge('s3_visualizations', 'results_consolidator', label='Visual Assets')
    
    # Processing Pipeline
    dot.edge('s3_processed', 'sagemaker_processor', label='Batch Data')
    dot.edge('sagemaker_processor', 'results_consolidator', label='Processed Results')
    
    return dot

def create_infrastructure_diagram():
    """
    Diagram 2: Cloud Infrastructure & Networking
    Shows AWS services, networking, and security architecture
    """
    dot = graphviz.Digraph(
        name='forestshield_infrastructure',
        comment='ForestShield Cloud Infrastructure',
        format='png'
    )
    
    # Configure graph attributes
    dot.attr(rankdir='TB', size='16,12', dpi='300')
    dot.attr('node', fontname='Arial', fontsize='10')
    dot.attr('edge', fontname='Arial', fontsize='8')
    
    # Define color scheme
    colors = {
        'vpc': '#E8F6F3',
        'compute': '#FDF2E9',
        'storage': '#EBF5FB',
        'database': '#F4ECF7',
        'monitoring': '#FEF9E7',
        'security': '#FDEDEC'
    }
    
    # VPC and Networking
    with dot.subgraph(name='cluster_vpc') as c:
        c.attr(label='VPC: ForestShield Network (10.0.0.0/16)', style='filled', color=colors['vpc'])
        
        # Public Subnets
        with c.subgraph(name='cluster_public') as pub:
            pub.attr(label='Public Subnets', style='filled', color='lightblue')
            pub.node('igw', 'Internet Gateway', shape='diamond')
            pub.node('nat1', 'NAT Gateway\nAZ-1', shape='box')
            pub.node('nat2', 'NAT Gateway\nAZ-2', shape='box')
        
        # Private Subnets
        with c.subgraph(name='cluster_private') as priv:
            priv.attr(label='Private Subnets', style='filled', color='lightcyan')
            priv.node('redis_cluster', 'ElastiCache Redis\n\n• Primary + Replica\n• Multi-AZ\n• Encryption at rest/transit', 
                     shape='cylinder', fillcolor=colors['database'], style='filled')
            priv.node('vpc_connector', 'VPC Connector\n\n• App Runner bridge\n• Security groups\n• Private networking', 
                     shape='ellipse')
    
    # Compute Services
    with dot.subgraph(name='cluster_compute') as c:
        c.attr(label='Compute Services', style='filled', color='lightgrey')
        c.node('app_runner', 'App Runner API\n\n• NestJS Application\n• Auto-scaling (1-10)\n• Health checks\n• Custom domain', 
               shape='box', fillcolor=colors['compute'], style='filled')
        c.node('step_functions', 'Step Functions\n\n• Workflow orchestration\n• Error handling\n• Parallel processing\n• State management', 
               shape='box', fillcolor=colors['compute'], style='filled')
        c.node('lambda_layer', 'Lambda Functions\n\n• 6 specialized functions\n• GDAL layer support\n• Java SnapStart\n• Auto-scaling', 
               shape='box', fillcolor=colors['compute'], style='filled')
    
    # Storage Services
    with dot.subgraph(name='cluster_storage') as c:
        c.attr(label='Storage Services', style='filled', color='lightgrey')
        c.node('s3_buckets', 'S3 Buckets\n\n• Processed Data\n• ML Models\n• Temporary Files\n• Athena Results', 
               shape='folder', fillcolor=colors['storage'], style='filled')
        c.node('dynamodb', 'DynamoDB Tables\n\n• Monitored Regions\n• Deforestation Alerts\n• GSI for queries', 
               shape='cylinder', fillcolor=colors['database'], style='filled')
    
    # Analytics & Monitoring
    with dot.subgraph(name='cluster_analytics') as c:
        c.attr(label='Analytics & Monitoring', style='filled', color='lightgrey')
        c.node('athena', 'Amazon Athena\n\n• Geospatial queries\n• Heatmap data\n• Partitioned tables', 
               shape='ellipse', fillcolor=colors['monitoring'], style='filled')
        c.node('glue', 'AWS Glue\n\n• Data catalog\n• Schema discovery\n• ETL crawlers', 
               shape='ellipse', fillcolor=colors['monitoring'], style='filled')
        c.node('cloudwatch', 'CloudWatch\n\n• Metrics & logs\n• Alarms\n• Cost monitoring', 
               shape='ellipse', fillcolor=colors['monitoring'], style='filled')
    
    # Security & IAM
    with dot.subgraph(name='cluster_security') as c:
        c.attr(label='Security & Access Control', style='filled', color='lightgrey')
        c.node('iam_roles', 'IAM Roles\n\n• Lambda execution\n• SageMaker training\n• App Runner instance\n• Step Functions', 
               shape='shield', fillcolor=colors['security'], style='filled')
        c.node('sns', 'SNS Topic\n\n• Deforestation alerts\n• Email notifications\n• Event-driven', 
               shape='ellipse', fillcolor=colors['security'], style='filled')
    
    # External Services
    dot.node('users', 'Users/API Clients', shape='person', fillcolor='lightgreen', style='filled')
    dot.node('sagemaker_external', 'SageMaker\n\n• Training jobs\n• ml.m5.large\n• K-means algorithm', 
             shape='ellipse', fillcolor=colors['compute'], style='filled')
    
    # Network Flow
    dot.edge('users', 'igw', label='HTTPS')
    dot.edge('igw', 'app_runner', label='Public Access')
    dot.edge('app_runner', 'vpc_connector', label='VPC Connection')
    dot.edge('vpc_connector', 'redis_cluster', label='Private Network')
    
    # Service Interactions
    dot.edge('app_runner', 'step_functions', label='Start Execution')
    dot.edge('step_functions', 'lambda_layer', label='Invoke Functions')
    dot.edge('lambda_layer', 's3_buckets', label='Read/Write Data')
    dot.edge('lambda_layer', 'sagemaker_external', label='Training Jobs')
    dot.edge('lambda_layer', 'dynamodb', label='State Management')
    
    # Analytics Flow
    dot.edge('s3_buckets', 'glue', label='Data Discovery')
    dot.edge('glue', 'athena', label='Query Engine')
    dot.edge('app_runner', 'athena', label='Geospatial Queries')
    
    # Monitoring & Alerts
    dot.edge('step_functions', 'sns', label='Alert Notifications')
    dot.edge('cloudwatch', 'sns', label='Alarm Triggers')
    
    # Security
    dot.edge('iam_roles', 'app_runner', label='Permissions', style='dashed')
    dot.edge('iam_roles', 'lambda_layer', label='Execution Role', style='dashed')
    dot.edge('iam_roles', 'step_functions', label='Service Role', style='dashed')
    
    return dot

def create_workflow_diagram():
    """
    Diagram 3: Step Functions Workflow & Lambda Orchestration
    Shows the detailed execution flow and decision points
    """
    dot = graphviz.Digraph(
        name='forestshield_workflow',
        comment='ForestShield Step Functions Workflow',
        format='png'
    )
    
    # Configure graph attributes
    dot.attr(rankdir='TB', size='14,18', dpi='300')
    dot.attr('node', fontname='Arial', fontsize='9')
    dot.attr('edge', fontname='Arial', fontsize='8')
    
    # Define color scheme
    colors = {
        'start': '#D5F4E6',
        'lambda': '#FFE6CC',
        'choice': '#FCF3CF',
        'parallel': '#E8F4FD',
        'sagemaker': '#D4E6F1',
        'end': '#FDEDEC',
        'error': '#FADBD8'
    }
    
    # Workflow States
    dot.node('start', 'START\n\nInput:\n• Latitude/Longitude\n• Date range\n• Cloud cover limit', 
             shape='ellipse', fillcolor=colors['start'], style='filled')
    
    # Image Search Phase
    dot.node('search_images', 'SearchSentinelImages\n(Lambda)\n\n• Query STAC API\n• Filter by criteria\n• Return image metadata', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('check_images', 'CheckImagesFound\n(Choice)\n\ncount > 0?', 
             shape='diamond', fillcolor=colors['choice'], style='filled')
    
    dot.node('no_images', 'NoImagesFound\n\nReturn:\n"NO_IMAGES_FOUND"', 
             shape='box', fillcolor=colors['error'], style='filled')
    
    # Parallel Processing
    dot.node('process_parallel', 'ProcessImagesParallel\n(Map State)\n\nMax Concurrency: 5\nProcess each image', 
             shape='parallelogram', fillcolor=colors['parallel'], style='filled')
    
    # NDVI Calculation
    dot.node('calc_ndvi', 'CalculateNDVI\n(VegetationAnalyzer)\n\n• Download Red/NIR bands\n• Apply GDAL processing\n• Generate training data', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('check_ndvi', 'CheckNDVISuccess\n(Choice)\n\nsuccess = true?', 
             shape='diamond', fillcolor=colors['choice'], style='filled')
    
    dot.node('ndvi_failed', 'NDVIFailed\n\nReturn:\n"NDVI_FAILED"', 
             shape='box', fillcolor=colors['error'], style='filled')
    
    # Model Management
    dot.node('check_model', 'CheckExistingModel\n(ModelManager)\n\n• Query by region + tile_id\n• Check model age\n• Return metadata', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('decide_strategy', 'DecideModelStrategy\n(Choice)\n\nmodel_exists = true?', 
             shape='diamond', fillcolor=colors['choice'], style='filled')
    
    # Existing Model Path
    dot.node('use_existing', 'UseExistingModel\n(VisualizationGenerator)\n\n• Load saved model\n• Generate visualizations\n• Skip training', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('existing_complete', 'UseExistingModelComplete\n\nStatus:\n"COMPLETED_WITH_MODEL_REUSE"', 
             shape='box', fillcolor=colors['end'], style='filled')
    
    # New Model Path
    dot.node('select_k', 'SelectOptimalK\n(K-Selector)\n\n• Run K=2 to K=10\n• Parallel SageMaker jobs\n• Elbow method analysis', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('sagemaker_training', 'StartSageMakerClustering\n(SageMaker Sync)\n\n• K-means algorithm\n• ml.m5.large instance\n• Wait for completion', 
             shape='ellipse', fillcolor=colors['sagemaker'], style='filled')
    
    dot.node('sagemaker_failed', 'SageMakerFailed\n\nReturn:\n"SAGEMAKER_FAILED"', 
             shape='box', fillcolor=colors['error'], style='filled')
    
    dot.node('save_model', 'SaveNewModel\n(ModelManager)\n\n• Store model artifacts\n• Update metadata\n• Version tracking', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('generate_viz', 'GenerateVisualizations\n(VisualizationGenerator)\n\n• Cluster plots\n• NDVI distributions\n• Geographic overlays', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('processing_complete', 'ProcessingComplete\n\nStatus:\n"COMPLETED"', 
             shape='box', fillcolor=colors['end'], style='filled')
    
    # Results Consolidation
    dot.node('consolidate', 'ConsolidateResults\n(ResultsConsolidator)\n\n• Generate PDF reports\n• Calculate confidence scores\n• Risk assessment', 
             shape='box', fillcolor=colors['lambda'], style='filled')
    
    dot.node('send_alert', 'SendDeforestationAlert\n(SNS Publish)\n\n• Professional email content\n• Attach visualizations\n• Risk summary', 
             shape='ellipse', fillcolor=colors['end'], style='filled')
    
    dot.node('end', 'END\n\nWorkflow Complete', 
             shape='ellipse', fillcolor=colors['end'], style='filled')
    
    # Workflow Connections
    dot.edge('start', 'search_images')
    dot.edge('search_images', 'check_images')
    dot.edge('check_images', 'no_images', label='count = 0', color='red')
    dot.edge('check_images', 'process_parallel', label='count > 0', color='green')
    
    # Parallel Processing Flow
    dot.edge('process_parallel', 'calc_ndvi')
    dot.edge('calc_ndvi', 'check_ndvi')
    dot.edge('check_ndvi', 'ndvi_failed', label='false', color='red')
    dot.edge('check_ndvi', 'check_model', label='true', color='green')
    
    # Model Decision Flow
    dot.edge('check_model', 'decide_strategy')
    dot.edge('decide_strategy', 'use_existing', label='true', color='blue')
    dot.edge('decide_strategy', 'select_k', label='false', color='orange')
    
    # Existing Model Path
    dot.edge('use_existing', 'existing_complete')
    
    # New Model Path
    dot.edge('select_k', 'sagemaker_training')
    dot.edge('sagemaker_training', 'sagemaker_failed', label='Failed', color='red')
    dot.edge('sagemaker_training', 'save_model', label='Success', color='green')
    dot.edge('save_model', 'generate_viz')
    dot.edge('generate_viz', 'processing_complete')
    
    # Final Consolidation
    dot.edge('existing_complete', 'consolidate', style='dashed')
    dot.edge('processing_complete', 'consolidate')
    dot.edge('consolidate', 'send_alert')
    dot.edge('send_alert', 'end')
    
    # Error Terminations
    dot.edge('no_images', 'end', color='red')
    dot.edge('ndvi_failed', 'end', color='red')
    dot.edge('sagemaker_failed', 'end', color='red')
    
    # Add retry and error handling annotations
    dot.node('retry_note', 'Retry Policy:\n• 2-3 attempts\n• Exponential backoff\n• Error catching\n• Graceful degradation', 
             shape='note', fillcolor='lightyellow', style='filled')
    
    return dot

def generate_all_diagrams():
    """Generate all three diagrams and save them as PNG files"""
    
    # Create output directory
    output_dir = 'diagrams'
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate timestamp for versioning
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    print("🚀 Generating ForestShield Technical Architecture Diagrams...")
    
    # Generate ML Pipeline Diagram
    print("📊 Creating ML Pipeline & Data Flow diagram...")
    ml_diagram = create_ml_pipeline_diagram()
    ml_diagram.render(f'{output_dir}/01_ml_pipeline_{timestamp}', cleanup=True)
    print(f"✅ ML Pipeline diagram saved: {output_dir}/01_ml_pipeline_{timestamp}.png")
    
    # Generate Infrastructure Diagram
    print("🏗️  Creating Cloud Infrastructure diagram...")
    infra_diagram = create_infrastructure_diagram()
    infra_diagram.render(f'{output_dir}/02_infrastructure_{timestamp}', cleanup=True)
    print(f"✅ Infrastructure diagram saved: {output_dir}/02_infrastructure_{timestamp}.png")
    
    # Generate Workflow Diagram
    print("🔄 Creating Step Functions Workflow diagram...")
    workflow_diagram = create_workflow_diagram()
    workflow_diagram.render(f'{output_dir}/03_workflow_{timestamp}', cleanup=True)
    print(f"✅ Workflow diagram saved: {output_dir}/03_workflow_{timestamp}.png")
    
    print(f"\n🎉 All diagrams generated successfully!")
    print(f"📁 Output directory: {output_dir}/")
    print(f"🏷️  Timestamp: {timestamp}")
    
    # Generate summary
    print("\n📋 Diagram Summary:")
    print("1. ML Pipeline & Data Flow - Shows the complete machine learning workflow")
    print("2. Cloud Infrastructure - Displays AWS services, networking, and security")
    print("3. Step Functions Workflow - Details the execution flow and decision points")
    
    return output_dir, timestamp

if __name__ == "__main__":
    try:
        output_dir, timestamp = generate_all_diagrams()
        
        print(f"\n💡 Usage Instructions:")
        print(f"   python diagram.py")
        print(f"   View the generated PNG files in the '{output_dir}' directory")
        print(f"\n🔧 Requirements:")
        print(f"   pip install graphviz")
        print(f"   System: Install Graphviz binary (https://graphviz.org/download/)")
        
    except Exception as e:
        print(f"❌ Error generating diagrams: {e}")
        print(f"💡 Make sure you have graphviz installed:")
        print(f"   pip install graphviz")
        print(f"   And the Graphviz system binary: https://graphviz.org/download/") 