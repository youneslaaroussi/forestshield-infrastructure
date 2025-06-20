# Use the lambgeo base image to build GDAL Python bindings
FROM ghcr.io/lambgeo/lambda-gdal:3.8-python3.11

ENV PACKAGE_PREFIX=/var/task

# Install zip command
RUN yum install -y zip

# Copy our Lambda function files
COPY handler.py ${PACKAGE_PREFIX}/handler.py
COPY ndvi_processor.py ${PACKAGE_PREFIX}/ndvi_processor.py
COPY s3_utils.py ${PACKAGE_PREFIX}/s3_utils.py
COPY requirements.txt ${PACKAGE_PREFIX}/requirements.txt

# Install Python dependencies from requirements.txt
# --no-binary GDAL is CRITICAL to force GDAL to compile against the C libs in the layer
RUN pip install --no-binary GDAL -r requirements.txt -t ${PACKAGE_PREFIX}/

# Remove unnecessary files to keep package small
RUN cd ${PACKAGE_PREFIX} && \
    find . -name "*.pyc" -delete && \
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true && \
    rm requirements.txt

# Create the deployment package (only Python code and bindings)
RUN cd $PACKAGE_PREFIX && zip -r9q /tmp/package.zip * 