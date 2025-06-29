# Use AWS Lambda Python runtime as base
FROM public.ecr.aws/lambda/python:3.9

ENV PACKAGE_PREFIX=/var/task

# Install zip command
RUN yum install -y zip

# Copy our Lambda function files
COPY handler.py ${PACKAGE_PREFIX}/handler.py
COPY requirements.txt ${PACKAGE_PREFIX}/requirements.txt

# Install Python dependencies
# Use compatible numpy version and force binary wheels to avoid compilation issues
RUN pip install boto3==1.34.131 numpy==1.24.3 typing-extensions==4.7.1 --only-binary=all -t ${PACKAGE_PREFIX}/

# Remove unnecessary files to keep package small and avoid import errors
RUN cd ${PACKAGE_PREFIX} && \
    find . -name "*.pyc" -delete && \
    find . -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find . -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true && \
    find . -name "test_*" -type f -delete 2>/dev/null || true && \
    find . -name "conftest.py" -type f -delete 2>/dev/null || true && \
    rm requirements.txt

# Create the deployment package
RUN cd $PACKAGE_PREFIX && zip -r9q /tmp/package.zip * 