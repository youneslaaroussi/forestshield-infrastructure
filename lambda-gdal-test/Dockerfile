# Use the lambgeo base image to build GDAL Python bindings
FROM ghcr.io/lambgeo/lambda-gdal:3.8-python3.11

ENV PACKAGE_PREFIX=/var/task

# Install zip command
RUN yum install -y zip

# Copy our Lambda function
COPY handler.py ${PACKAGE_PREFIX}/handler.py

# Install GDAL Python bindings that will link to the layer's C libraries
# We only install the Python bindings, not the C libraries (those come from the layer)
RUN pip install GDAL==$(gdal-config --version) --no-binary GDAL -t ${PACKAGE_PREFIX}/

# Remove unnecessary files to keep package small
RUN cd ${PACKAGE_PREFIX} && \
    find . -name "*.pyc" -delete && \
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true

# Create the deployment package (only Python code and bindings)
RUN cd $PACKAGE_PREFIX && zip -r9q /tmp/package.zip * 