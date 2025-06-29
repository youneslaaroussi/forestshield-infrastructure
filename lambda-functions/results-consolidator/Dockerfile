# Use Amazon Linux 2 base image that matches Lambda runtime
FROM public.ecr.aws/lambda/python:3.9

ENV PACKAGE_PREFIX=/var/task

# Install system dependencies for PIL/Pillow
RUN yum update -y && \
    yum install -y \
    gcc \
    gcc-c++ \
    freetype-devel \
    libjpeg-turbo-devel \
    libpng-devel \
    libtiff-devel \
    libwebp-devel \
    zlib-devel \
    zip && \
    yum clean all

# Copy our Lambda function files
COPY handler.py ${PACKAGE_PREFIX}/handler.py
COPY requirements.txt ${PACKAGE_PREFIX}/requirements.txt

# Install Python dependencies with proper compilation for Lambda environment
# Use binary wheels where possible, compile where necessary
RUN pip install --upgrade pip && \
    pip install \
    boto3==1.34.34 \
    reportlab==4.0.9 \
    Pillow==10.1.0 \
    --target ${PACKAGE_PREFIX}/ \
    --no-cache-dir

# Remove unnecessary files to keep package small
RUN cd ${PACKAGE_PREFIX} && \
    find . -name "*.pyc" -delete && \
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find . -name "*.dist-info" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find . -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true && \
    rm -rf pip* setuptools* wheel* && \
    rm requirements.txt

# Create the deployment package
RUN cd $PACKAGE_PREFIX && zip -r9q /tmp/package.zip * 