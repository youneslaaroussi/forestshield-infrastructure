import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  AthenaClient, 
  StartQueryExecutionCommand, 
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState
} from '@aws-sdk/client-athena';

export interface HeatmapPoint {
  latitude: number;
  longitude: number;
  intensity: number; // e.g., NDVI value
}

@Injectable()
export class GeospatialService {
  private readonly logger = new Logger(GeospatialService.name);
  private readonly athena: AthenaClient;
  private readonly athenaDatabase: string;
  private readonly athenaTable: string;
  private readonly athenaWorkgroup: string;
  private readonly athenaOutputLocation: string;

  constructor(private readonly configService: ConfigService) {
    const awsRegion = this.configService.get<string>('AWS_REGION');
    this.athena = new AthenaClient({ region: awsRegion });
    
    this.athenaDatabase = this.configService.get<string>('ATHENA_DATABASE', 'forestshield_prod');
    this.athenaTable = this.configService.get<string>('ATHENA_GEOSPATIAL_TABLE', 'geospatial_data');
    this.athenaWorkgroup = this.configService.get<string>('ATHENA_WORKGROUP', 'primary');
    this.athenaOutputLocation = this.configService.get<string>('ATHENA_OUTPUT_LOCATION');

    if (!this.athenaOutputLocation) {
        throw new Error('ATHENA_OUTPUT_LOCATION environment variable is not set.');
    }
  }

  async getHeatmapData(
    north: number,
    south: number,
    east: number,
    west: number,
    days: number = 30
  ): Promise<HeatmapPoint[]> {
    this.logger.log(`Fetching heatmap data for bounding box: [${north}, ${west}] to [${south}, ${east}]`);

    // --- Bounding Box Expansion ---
    // Expand the bounding box to be less restrictive and find nearby data.
    // This helps when the user's viewport doesn't perfectly align with data points.
    const latitudinal_expansion = (north - south) * 0.25; // Expand by 25%
    const longitudinal_expansion = (east - west) * 0.25;

    const expanded_north = north + latitudinal_expansion;
    const expanded_south = south - latitudinal_expansion;
    const expanded_east = east + longitudinal_expansion;
    const expanded_west = west - longitudinal_expansion;

    this.logger.log(`Expanded bounding box to: [${expanded_north}, ${expanded_west}] to [${expanded_south}, ${expanded_east}]`);


    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Note: Partition pruning is automatically done by Athena if partitions are set up correctly.
    const query = `
      SELECT latitude, longitude, ndvi
      FROM "${this.athenaDatabase}"."${this.athenaTable}"
      WHERE date_parse(substr(timestamp, 1, 10), '%Y-%m-%d') >= date('${startDate.toISOString().split('T')[0]}')
        AND latitude BETWEEN ${expanded_south} AND ${expanded_north}
        AND longitude BETWEEN ${expanded_west} AND ${expanded_east}
      LIMIT 10000;
    `;

    this.logger.debug(`Executing Athena query: ${query}`);

    try {
      const queryExecutionId = await this.startQuery(query);
      await this.waitForQueryToComplete(queryExecutionId);
      const results = await this.getQueryResults(queryExecutionId);
      let points = this.parseResults(results);

      // If no results are found in the bounding box, fetch the most recent data from anywhere as a fallback.
      if (points.length === 0) {
        this.logger.log('No data found in the specified bounding box. Executing a fallback query for recent global data.');
        
        const fallbackQuery = `
          SELECT latitude, longitude, ndvi
          FROM "${this.athenaDatabase}"."${this.athenaTable}"
          WHERE date_parse(substr(timestamp, 1, 10), '%Y-%m-%d') >= date('${startDate.toISOString().split('T')[0]}')
          LIMIT 5000;
        `;

        this.logger.debug(`Executing Athena fallback query: ${fallbackQuery}`);
        const fallbackQueryId = await this.startQuery(fallbackQuery);
        await this.waitForQueryToComplete(fallbackQueryId);
        const fallbackResults = await this.getQueryResults(fallbackQueryId);
        points = this.parseResults(fallbackResults);
      }

      return points;
    } catch (error) {
      if (error.message && error.message.includes('TABLE_NOT_FOUND')) {
        this.logger.warn(`Athena table '${this.athenaTable}' not found or not yet populated. Returning empty heatmap. This is expected on a new deployment.`);
        return [];
      }
      this.logger.error(`Athena query failed: ${error.message}`, error.stack);
      throw new Error('Failed to retrieve heatmap data from Athena.');
    }
  }

  private async startQuery(query: string): Promise<string> {
    const command = new StartQueryExecutionCommand({
      QueryString: query,
      WorkGroup: this.athenaWorkgroup,
      ResultConfiguration: {
        OutputLocation: this.athenaOutputLocation,
      },
    });
    const response = await this.athena.send(command);
    return response.QueryExecutionId;
  }

  private async waitForQueryToComplete(queryExecutionId: string): Promise<void> {
    while (true) {
      const command = new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId });
      const response = await this.athena.send(command);
      const state = response.QueryExecution.Status.State;

      if (state === QueryExecutionState.SUCCEEDED) {
        return;
      }
      if (state === QueryExecutionState.FAILED || state === QueryExecutionState.CANCELLED) {
        const reason = response.QueryExecution.Status.StateChangeReason;
        throw new Error(`Query failed or was cancelled. Reason: ${reason}`);
      }
      // Wait for a bit before polling again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  private async getQueryResults(queryExecutionId: string): Promise<any> {
    const command = new GetQueryResultsCommand({ QueryExecutionId: queryExecutionId });
    const response = await this.athena.send(command);
    return response;
  }

  private parseResults(results: any): HeatmapPoint[] {
    const points: HeatmapPoint[] = [];
    const rows = results.ResultSet.Rows.slice(1); // Skip header row

    for (const row of rows) {
      const data = row.Data;
      points.push({
        latitude: parseFloat(data[0].VarCharValue),
        longitude: parseFloat(data[1].VarCharValue),
        intensity: parseFloat(data[2].VarCharValue),
      });
    }
    return points;
  }
} 