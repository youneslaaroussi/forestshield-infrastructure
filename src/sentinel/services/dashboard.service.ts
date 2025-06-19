import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  ScanCommand, 
  PutCommand, 
  GetCommand, 
  DeleteCommand, 
  UpdateCommand,
  QueryCommand
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';
import { RegionDto, CreateRegionDto, AlertDto, AlertLevel, RegionStatus } from '../dto/dashboard.dto';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);
  private readonly docClient: DynamoDBDocumentClient;
  private readonly regionsTable: string;
  private readonly alertsTable: string;

  constructor(private readonly configService: ConfigService) {
    const ddbClient = new DynamoDBClient({
      region: this.configService.get<string>('AWS_REGION'),
    });
    this.docClient = DynamoDBDocumentClient.from(ddbClient);
    this.regionsTable = this.configService.get<string>('MONITORED_REGIONS_TABLE_NAME', '');
    this.alertsTable = this.configService.get<string>('DEFORESTATION_ALERTS_TABLE_NAME', '');
  }

  // Region Management
  async getAllRegions(status?: RegionStatus): Promise<RegionDto[]> {
    const command = new ScanCommand({
      TableName: this.regionsTable,
      FilterExpression: status ? '#status = :status' : undefined,
      ExpressionAttributeNames: status ? { '#status': 'status' } : undefined,
      ExpressionAttributeValues: status ? { ':status': status } : undefined,
    });
    const result = await this.docClient.send(command);
    return result.Items as RegionDto[];
  }

  async createRegion(createRegionDto: CreateRegionDto): Promise<RegionDto> {
    const newRegion: RegionDto = {
      id: randomUUID(),
      ...createRegionDto,
      status: RegionStatus.ACTIVE,
      createdAt: new Date().toISOString(),
      lastDeforestationPercentage: 0,
      lastAnalysis: new Date().toISOString(),
    };
    const command = new PutCommand({
      TableName: this.regionsTable,
      Item: newRegion,
    });
    await this.docClient.send(command);
    return newRegion;
  }

  async getRegionById(id: string): Promise<RegionDto> {
    const command = new GetCommand({
      TableName: this.regionsTable,
      Key: { id },
    });
    const result = await this.docClient.send(command);
    return result.Item as RegionDto;
  }

  async updateRegion(id: string, updateData: Partial<RegionDto>): Promise<RegionDto> {
    const keys = Object.keys(updateData);
    const command = new UpdateCommand({
      TableName: this.regionsTable,
      Key: { id },
      UpdateExpression: `SET ${keys.map((k, i) => `#${k} = :${k}`).join(', ')}`,
      ExpressionAttributeNames: keys.reduce((acc, k) => ({ ...acc, [`#${k}`]: k }), {}),
      ExpressionAttributeValues: keys.reduce((acc, k) => ({ ...acc, [`:${k}`]: updateData[k] }), {}),
      ReturnValues: 'ALL_NEW',
    });
    const result = await this.docClient.send(command);
    return result.Attributes as RegionDto;
  }

  async deleteRegion(id: string): Promise<void> {
    const command = new DeleteCommand({
      TableName: this.regionsTable,
      Key: { id },
    });
    await this.docClient.send(command);
  }

  // Alert Management
  async getAlerts(level?: AlertLevel, acknowledged?: boolean): Promise<AlertDto[]> {
    // This is a more complex query. For now, we'll scan and filter.
    // For production, you'd want to optimize with GSI.
    const command = new ScanCommand({ TableName: this.alertsTable });
    let items = (await this.docClient.send(command)).Items as AlertDto[];

    if (level) {
      items = items.filter(i => i.level === level);
    }
    if (acknowledged !== undefined) {
      items = items.filter(i => i.acknowledged === acknowledged);
    }
    return items;
  }

  async acknowledgeAlert(id: string): Promise<AlertDto> {
    const command = new UpdateCommand({
      TableName: this.alertsTable,
      Key: { id },
      UpdateExpression: 'SET acknowledged = :acknowledged',
      ExpressionAttributeValues: { ':acknowledged': true },
      ReturnValues: 'ALL_NEW',
    });
    const result = await this.docClient.send(command);
    return result.Attributes as AlertDto;
  }

  // This would be called by your processing workflow
  async createAlert(region: RegionDto, deforestationPercentage: number): Promise<AlertDto> {
    let level = AlertLevel.LOW;
    if (deforestationPercentage > 10) level = AlertLevel.HIGH;
    else if (deforestationPercentage > 5) level = AlertLevel.MODERATE;

    const newAlert: AlertDto = {
      id: randomUUID(),
      regionId: region.id,
      regionName: region.name,
      level,
      deforestationPercentage,
      message: `Deforestation level at ${deforestationPercentage}% in ${region.name}`,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    };

    const command = new PutCommand({
      TableName: this.alertsTable,
      Item: newAlert,
    });
    await this.docClient.send(command);
    return newAlert;
  }
} 