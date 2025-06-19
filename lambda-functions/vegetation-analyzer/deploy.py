#!/usr/bin/env python3
"""
ForestShield Vegetation Analyzer - Deployment Package Creator
Creates a ZIP deployment package for AWS Lambda
"""

import os
import zipfile
import shutil
import subprocess
import sys
from pathlib import Path

def create_deployment_package():
    """Create deployment package for Lambda"""
    
    print("🐍 Creating Python Lambda deployment package...")
    
    # Clean up previous builds
    if os.path.exists('vegetation-analyzer-deployment.zip'):
        os.remove('vegetation-analyzer-deployment.zip')
        print("   🧹 Cleaned up previous deployment package")
    
    # Create deployment package
    with zipfile.ZipFile('vegetation-analyzer-deployment.zip', 'w', zipfile.ZIP_DEFLATED) as zipf:
        
        # Add Python source files
        python_files = [
            'handler.py',
            'ndvi_processor.py', 
            's3_utils.py'
        ]
        
        for file in python_files:
            if os.path.exists(file):
                zipf.write(file)
                print(f"   📄 Added {file}")
            else:
                print(f"   ⚠️ Warning: {file} not found")
        
        # Add requirements if they exist
        if os.path.exists('requirements.txt'):
            zipf.write('requirements.txt')
            print("   📄 Added requirements.txt")
    
    # Check final package size
    package_size = os.path.getsize('vegetation-analyzer-deployment.zip')
    package_mb = package_size / (1024 * 1024)
    
    print(f"   📦 Package created: vegetation-analyzer-deployment.zip ({package_mb:.1f} MB)")
    
    if package_mb > 50:
        print("   ⚠️ Warning: Package is larger than 50MB, consider optimizing")
    
    print("✅ Deployment package ready!")
    return True

if __name__ == '__main__':
    create_deployment_package() 