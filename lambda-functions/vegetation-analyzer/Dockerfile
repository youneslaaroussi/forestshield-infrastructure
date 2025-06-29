# Use the lambgeo base image to build GDAL Python bindings - MATCH LAMBDA RUNTIME
FROM ghcr.io/lambgeo/lambda-gdal:3.8-python3.9

ENV PACKAGE_PREFIX=/var/task

# Install zip command
RUN yum install -y zip

# Copy our Lambda function files
COPY handler.py ${PACKAGE_PREFIX}/handler.py
COPY ndvi_processor.py ${PACKAGE_PREFIX}/ndvi_processor.py
COPY s3_utils.py ${PACKAGE_PREFIX}/s3_utils.py
COPY requirements.txt ${PACKAGE_PREFIX}/requirements.txt

# Install Python dependencies - CRITICAL FIX FOR NUMPY IMPORT ERROR
# Install GDAL with --no-binary to compile against C libs in the lambgeo layer
RUN pip install GDAL==3.8.3 --no-binary GDAL -t ${PACKAGE_PREFIX}/

# Install numpy, rasterio, and pyproj with specific versions as binary wheels ONLY
# Force binary wheels to avoid GCC version conflicts
RUN pip install numpy==1.24.3 rasterio==1.3.8 pyproj==3.6.1 --only-binary=all -t ${PACKAGE_PREFIX}/

# Remove unnecessary files to keep package small
RUN cd ${PACKAGE_PREFIX} && \
    find . -name "*.pyc" -delete && \
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true && \
    rm requirements.txt

# Create the deployment package (only Python code and bindings)
RUN cd $PACKAGE_PREFIX && zip -r9q /tmp/package.zip * 