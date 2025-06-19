import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';

export interface DownloadResult {
  success: boolean;
  localPath?: string;
  fileSize?: number;
  error?: string;
  url: string;
}

@Injectable()
export class ImageDownloadService {
  private readonly logger = new Logger(ImageDownloadService.name);
  private readonly downloadDir = './downloads';

  constructor(private readonly httpService: HttpService) {
    // Ensure download directory exists
    if (!fs.existsSync(this.downloadDir)) {
      fs.mkdirSync(this.downloadDir, { recursive: true });
    }
  }

  async downloadImage(url: string, filename?: string): Promise<DownloadResult> {
    try {
      this.logger.log(`Starting download: ${url}`);
      
      // Generate filename if not provided
      if (!filename) {
        const urlParts = url.split('/');
        filename = urlParts[urlParts.length - 1];
      }
      
      const localPath = path.join(this.downloadDir, filename);
      
      // Check if file already exists
      if (fs.existsSync(localPath)) {
        const stats = fs.statSync(localPath);
        this.logger.log(`File already exists: ${localPath} (${stats.size} bytes)`);
        return {
          success: true,
          localPath,
          fileSize: stats.size,
          url,
        };
      }

      // Download the file
      const response = await firstValueFrom(
        this.httpService.get(url, {
          responseType: 'stream',
          timeout: 60000, // 60 second timeout
        })
      );

      // Create write stream
      const writer = fs.createWriteStream(localPath);
      
      // Pipe the response to file
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          const stats = fs.statSync(localPath);
          this.logger.log(`Download completed: ${localPath} (${stats.size} bytes)`);
          resolve({
            success: true,
            localPath,
            fileSize: stats.size,
            url,
          });
        });

        writer.on('error', (error) => {
          this.logger.error(`Download failed: ${error.message}`);
          reject({
            success: false,
            error: error.message,
            url,
          });
        });
      });

    } catch (error) {
      this.logger.error(`Error downloading ${url}:`, error.message);
      return {
        success: false,
        error: error.message,
        url,
      };
    }
  }

  async downloadMultipleImages(urls: string[]): Promise<DownloadResult[]> {
    this.logger.log(`Starting download of ${urls.length} images`);
    
    const results: DownloadResult[] = [];
    
    // Download images one by one to avoid overwhelming the server
    for (const url of urls) {
      const result = await this.downloadImage(url);
      results.push(result);
      
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
  }

  async downloadAmazonSamples(): Promise<DownloadResult[]> {
    this.logger.log('Downloading sample Amazon satellite images...');
    
    // We'll get recent data and download the visual (RGB) composites with unique names
    const sampleImages = [
      { url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2B_22MBU_20220831_0_L2A/TCI.tif', filename: 'Amazon_20220831_S2B_TCI.tif' },
      { url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2A_22MBU_20220829_0_L2A/TCI.tif', filename: 'Amazon_20220829_S2A_TCI.tif' },
      { url: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/22/M/BU/2022/8/S2B_22MBU_20220824_0_L2A/TCI.tif', filename: 'Amazon_20220824_S2B_TCI.tif' },
    ];

    const results: DownloadResult[] = [];
    
    for (const image of sampleImages) {
      const result = await this.downloadImage(image.url, image.filename);
      results.push(result);
      
      // Small delay between downloads
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return results;
  }

  getDownloadDirectory(): string {
    return path.resolve(this.downloadDir);
  }

  listDownloadedFiles(): Array<{ filename: string; size: number; path: string }> {
    try {
      const files = fs.readdirSync(this.downloadDir);
      return files.map(filename => {
        const fullPath = path.join(this.downloadDir, filename);
        const stats = fs.statSync(fullPath);
        return {
          filename,
          size: stats.size,
          path: fullPath,
        };
      });
    } catch (error) {
      this.logger.error('Error listing downloaded files:', error);
      return [];
    }
  }

  async downloadBands(imageId: string, bandUrls: { B04?: string; B08?: string; B02?: string; B03?: string }): Promise<DownloadResult[]> {
    this.logger.log(`Downloading bands for image: ${imageId}`);
    
    const results: DownloadResult[] = [];
    
    for (const [bandName, url] of Object.entries(bandUrls)) {
      if (url) {
        const filename = `${imageId}_${bandName}.tif`;
        const result = await this.downloadImage(url, filename);
        results.push(result);
      }
    }
    
    return results;
  }
} 