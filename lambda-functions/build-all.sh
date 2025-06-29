#!/bin/bash

# ForestShield Lambda Functions Build Script
# Builds all Java Lambda functions with SnapStart support

set -e

echo "🚀 Building ForestShield Java Lambda Functions with SnapStart..."
echo "=================================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to build a single Lambda
build_lambda() {
    local lambda_name=$1
    local lambda_path="./$lambda_name"
    
    echo -e "${BLUE}📦 Building $lambda_name...${NC}"
    
    if [ ! -d "$lambda_path" ]; then
        echo -e "${RED}❌ Directory $lambda_path not found${NC}"
        return 1
    fi
    
    # Store the original directory
    original_dir=$(pwd)
    
    cd "$lambda_path"
    
    # Clean and compile
    echo -e "${YELLOW}   🧹 Cleaning...${NC}"
    mvn clean
    
    echo -e "${YELLOW}   🔨 Compiling...${NC}"
    mvn compile
    
    echo -e "${YELLOW}   📦 Packaging...${NC}"
    mvn package
    
    # Check if JAR was created
    if [ -f "target/$lambda_name-1.0.0.jar" ]; then
        echo -e "${GREEN}   ✅ Build successful: $lambda_name-1.0.0.jar${NC}"
        
        # Get JAR size
        jar_size=$(du -h "target/$lambda_name-1.0.0.jar" | cut -f1)
        echo -e "${BLUE}   📊 Fat JAR created: $jar_size${NC}"
    else
        echo -e "${RED}   ❌ Build failed for $lambda_name${NC}"
        cd "$original_dir"
        return 1
    fi
    
    # Return to original directory
    cd "$original_dir"
    echo ""
}

# Build all Lambda functions
echo -e "${BLUE}🔍 Found Lambda functions:${NC}"
ls -1 ./ | grep -v "step-functions\|build-all.sh\|deploy-all.sh" | while read lambda; do
    echo "  - $lambda"
done
echo ""

# Build Python Lambdas
echo -e "${BLUE}🐍 Building Python Lambda: vegetation-analyzer (with GDAL layer)${NC}"
cd vegetation-analyzer
chmod +x build.sh
echo -e "${YELLOW}   🐳 Building with Docker + lambgeo layer...${NC}"
./build.sh
echo -e "${GREEN}   ✅ Python Lambda packaged with GDAL bindings: vegetation-analyzer-deployment.zip${NC}"
cd ..

echo -e "${BLUE}🔄 Building Python Lambda: results-consolidator (lightweight)${NC}"
cd results-consolidator
chmod +x build.sh
echo -e "${YELLOW}   📦 Building pure Python package...${NC}"
./build.sh
echo -e "${GREEN}   ✅ Python Lambda packaged: results-consolidator-deployment.zip${NC}"
cd ..

echo -e "${BLUE}🗄️ Building Python Lambda: model-manager (lightweight)${NC}"
cd model-manager
chmod +x build.sh
echo -e "${YELLOW}   📦 Building pure Python package...${NC}"
./build.sh
echo -e "${GREEN}   ✅ Python Lambda packaged: model-manager-deployment.zip${NC}"
cd ..

echo -e "${BLUE}🎨 Building Python Lambda: visualization-generator (with matplotlib)${NC}"
cd visualization-generator
chmod +x build.sh
echo -e "${YELLOW}   📊 Building with matplotlib + seaborn + pandas...${NC}"
./build.sh
echo -e "${GREEN}   ✅ Python Lambda packaged: visualization-generator-deployment.zip${NC}"
cd ..

echo -e "${BLUE}🎯 Building Python Lambda: k-selector (PHASE 2.2 - Dynamic K Selection)${NC}"
cd k-selector
chmod +x build.sh
echo -e "${YELLOW}   🧮 Building with numpy for K-means optimization...${NC}"
./build.sh
echo -e "${GREEN}   ✅ Python Lambda packaged: k-selector-lambda.zip${NC}"
cd ..

# Build Java Lambdas
build_lambda "search-images" 
build_lambda "sagemaker-processor"

echo -e "${GREEN}🎉 All Lambda functions built successfully!${NC}"
echo ""
echo -e "${BLUE}📋 Summary:${NC}"
echo "   • Vegetation Analyzer - Python 3.11 + lambgeo layer + GDAL 3.8.3 + rasterio"
echo "   • Results Consolidator - Python 3.11 + pure Python (no dependencies)"
echo "   • Model Manager - Python 3.11 + pure Python (boto3 for S3/DynamoDB)"
echo "   • Visualization Generator - Python 3.11 + matplotlib + seaborn + pandas"
echo "   • K-Selector (PHASE 2.2) - Python 3.11 + numpy (Dynamic K Selection)"
echo "   • Search Images - Java 17 + SnapStart + HTTP Client"
echo "   • SageMaker Processor - Java 17 + SnapStart + ML"
echo ""
echo -e "${YELLOW}🚀 SnapStart Benefits:${NC}"
echo "   • Zero cold start latency"
echo "   • Pre-initialized JVM"
echo "   • Optimized performance"
echo ""
echo -e "${BLUE}📦 Next steps:${NC}"
echo "   1. Deploy with: ./deploy-all.sh"
echo "   2. Enable SnapStart in AWS Console"
echo "   3. Test with zero latency!"
echo ""
echo -e "${GREEN}✨ ForestShield Lambda functions ready for deployment!${NC}" 