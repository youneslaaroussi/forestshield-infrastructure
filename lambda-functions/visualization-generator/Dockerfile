# Use the same lambgeo base image as vegetation-analyzer - MATCH LAMBDA RUNTIME
FROM ghcr.io/lambgeo/lambda-gdal:3.8-python3.9

ENV PACKAGE_PREFIX=/var/task

# Install zip command
RUN yum install -y zip

# Copy our Lambda function files
COPY handler.py ${PACKAGE_PREFIX}/handler.py
COPY requirements.txt ${PACKAGE_PREFIX}/requirements.txt

# Install Python dependencies - COPY THE SUCCESSFUL APPROACH FROM VEGETATION-ANALYZER
# Use numpy 1.24.3 which is known to work well in Lambda (same as vegetation-analyzer)
# Force binary wheels to avoid compilation conflicts
RUN pip install numpy==1.24.3 matplotlib==3.8.4 seaborn==0.13.2 pandas==2.2.2 boto3==1.34.131 --only-binary=all -t ${PACKAGE_PREFIX}/

# Remove unnecessary files to keep package small
RUN cd ${PACKAGE_PREFIX} && \
    find . -name "*.pyc" -delete && \
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true && \
    rm requirements.txt

# Create the deployment package (only Python code and bindings)
RUN cd $PACKAGE_PREFIX && zip -r9q /tmp/package.zip * 