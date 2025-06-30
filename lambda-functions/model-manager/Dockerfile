# Use the official AWS Lambda Python 3.9 base image
FROM public.ecr.aws/lambda/python:3.9

# Set the working directory in the container
WORKDIR ${LAMBDA_TASK_ROOT}

# Copy the requirements file into the container
COPY requirements.txt .

# Install the Python dependencies
RUN pip install -r requirements.txt --target "${LAMBDA_TASK_ROOT}"

# Copy the Lambda function handler code
COPY handler.py .

# Set the CMD to your handler (this is how Lambda will run the code)
CMD [ "handler.lambda_handler" ] 