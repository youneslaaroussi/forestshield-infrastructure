import { Injectable, Logger } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand, GetObjectCommandInput } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { SageMakerClient, CreateProcessingJobCommand, DescribeProcessingJobCommand } from '@aws-sdk/client-sagemaker';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AWSService {
  private readonly logger = new Logger(AWSService.name);
  private readonly s3Client: S3Client;
  private readonly sageMakerClient: SageMakerClient;
  private readonly lambdaClient: LambdaClient;
  private readonly sfnClient: SFNClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get('AWS_REGION', 'us-east-1');
    
    this.s3Client = new S3Client({ region });
    this.sageMakerClient = new SageMakerClient({ region });
    this.lambdaClient = new LambdaClient({ region });
    this.sfnClient = new SFNClient({ region });
    
    this.logger.log('AWS Service initialized with real AWS clients');
  }

  async uploadToS3(bucketName: string, key: string, data: Buffer): Promise<string> {
    this.logger.log(`Uploading to S3: ${bucketName}/${key}`);
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: data,
    });

    await this.s3Client.send(command);
    const s3Url = `s3://${bucketName}/${key}`;
    this.logger.log(`Successfully uploaded to ${s3Url}`);
    return s3Url;
  }

  async downloadFromS3(bucketName: string, key: string): Promise<Buffer> {
    this.logger.log(`Downloading from S3: ${bucketName}/${key}`);
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const response = await this.s3Client.send(command);
    const chunks: Uint8Array[] = [];
    
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  }

  async generateS3SignedUrl(bucketName: string, key: string, expiresIn: number = 3600): Promise<string> {
    this.logger.log(`Generating signed URL for S3: ${bucketName}/${key}`);
    
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });

    const signedUrl = await getSignedUrl(this.s3Client as any, command, { expiresIn });
    this.logger.log(`Generated signed URL expires in ${expiresIn} seconds`);
    
    return signedUrl;
  }

  async startSageMakerProcessingJob(jobName: string, inputDataConfig: any, outputDataConfig: any, processingResources: any): Promise<string> {
    this.logger.log(`Starting SageMaker processing job: ${jobName}`);
    
    const command = new CreateProcessingJobCommand({
      ProcessingJobName: jobName,
      ProcessingInputs: inputDataConfig,
      ProcessingOutputConfig: outputDataConfig,
      ProcessingResources: processingResources,
      AppSpecification: {
        ImageUri: '382416733822.dkr.ecr.us-east-1.amazonaws.com/xgboost:latest',
        ContainerEntrypoint: ['python3', '/opt/ml/code/kmeans_clustering.py'],
      },
      RoleArn: this.getSageMakerRoleArn(),
    });

    await this.sageMakerClient.send(command);
    this.logger.log(`SageMaker processing job ${jobName} started successfully`);
    return jobName;
  }

  private getSageMakerRoleArn(): string {
    const roleArn = this.configService.get<string>('SAGEMAKER_ROLE_ARN');
    if (!roleArn) {
      throw new Error('SAGEMAKER_ROLE_ARN environment variable is required');
    }
    return roleArn;
  }

  async getSageMakerJobStatus(jobName: string): Promise<string> {
    this.logger.log(`Getting SageMaker job status: ${jobName}`);
    
    const command = new DescribeProcessingJobCommand({
      ProcessingJobName: jobName,
    });

    const response = await this.sageMakerClient.send(command);
    
    if (!response.ProcessingJobStatus) {
      throw new Error(`Failed to get processing job status for ${jobName}`);
    }
    
    return response.ProcessingJobStatus;
  }

  async invokeLambda(functionName: string, payload: any): Promise<any> {
    this.logger.log(`Invoking Lambda function: ${functionName}`);
    
    const command = new InvokeCommand({
      FunctionName: functionName,
      Payload: JSON.stringify(payload),
    });

    const response = await this.lambdaClient.send(command);
    
    if (response.FunctionError) {
      throw new Error(`Lambda function error: ${response.FunctionError}`);
    }

    const result = JSON.parse(new TextDecoder().decode(response.Payload));
    this.logger.log(`Lambda function ${functionName} executed successfully`);
    return result;
  }

  async startStepFunctionsExecution(stateMachineArn: string, input: any): Promise<{ executionArn: string }> {
    this.logger.log(`Starting Step Functions execution: ${stateMachineArn}`);
    
    const command = new StartExecutionCommand({
      stateMachineArn,
      input: JSON.stringify(input),
      name: `execution-${Date.now()}`,
    });

    const response = await this.sfnClient.send(command);
    this.logger.log(`Started Step Functions execution: ${response.executionArn}`);

    if (!response.executionArn) {
      throw new Error('Failed to start Step Functions execution');
    }
    
    return {
      executionArn: response.executionArn,
    };
  }
} 