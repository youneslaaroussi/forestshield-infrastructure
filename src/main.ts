import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as fs from 'fs';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for dashboard UI development
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001', 
      'https://forestshieldapp.com',
      'https://api.forestshieldapp.com',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    credentials: true,
  });

  // Global validation pipe for DTOs
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  const port = process.env.PORT ?? 3000;

  // Swagger API documentation setup
  const config = new DocumentBuilder()
    .setTitle('ForestShield API')
    .setDescription(`
# ForestShield API
AWS-powered deforestation detection using Sentinel-2 satellite imagery

## REST API Endpoints
This documentation covers the RESTful API endpoints for ForestShield.

## Real-Time WebSocket Gateway
**Namespace:** \`/aws-realtime\`  
**Connection URL:** \`ws://localhost:${port}/aws-realtime\`

### Available WebSocket Streams:
- **aws-metrics** - Real-time AWS service metrics (default: 30s interval)
- **aws-logs** - CloudWatch logs streaming (default: 10s interval)  
- **aws-activity** - AWS activity feed (default: 15s interval)
- **aws-costs** - Cost and usage data (default: 60s interval)
- **aws-health** - Combined health monitoring (default: 20s interval)
- **aws-security** - Security health checks (default: 45s interval)

### WebSocket Events:
#### Client → Server:
- \`subscribe-aws-metrics\` - Subscribe to metrics with optional interval
- \`subscribe-aws-logs\` - Subscribe to logs with optional logGroup and interval
- \`subscribe-aws-activity\` - Subscribe to activity feed
- \`subscribe-aws-costs\` - Subscribe to cost updates
- \`subscribe-aws-health\` - Subscribe to health monitoring
- \`subscribe-aws-security\` - Subscribe to security updates
- \`unsubscribe\` - Unsubscribe from specific stream
- \`get-status\` - Get client connection status

#### Server → Client:
- \`connection-established\` - Connection confirmation with available streams
- \`subscription-confirmed\` - Subscription confirmation with details
- \`unsubscribe-confirmed\` - Unsubscription confirmation
- \`aws-*-update\` - Real-time data updates for each stream type
- \`aws-error\` - Error notifications
- \`status-update\` - Client status information
- \`system-event\` - System-wide broadcast events

### Example WebSocket Usage:
\`\`\`javascript
const socket = io('ws://localhost:${port}/aws-realtime');

// Subscribe to metrics every 30 seconds
socket.emit('subscribe-aws-metrics', { interval: 30000 });

// Listen for updates
socket.on('aws-metrics-update', (data) => {
  console.log('Metrics:', data);
});
\`\`\`
    `)
    .setVersion('1.0.0')
    .setContact(
      'ForestShield Team',
      'https://github.com/forestshield',
      'contact@forestshield.com'
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addTag('analysis', 'Deforestation analysis and processing')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // Add an explicit route to serve the Swagger JSON
  app.getHttpAdapter().get('/api/docs/json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(document);
  });
  
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
      docExpansion: 'none',
      filter: true,
      showRequestHeaders: true,
    },
    customSiteTitle: 'ForestShield API Documentation',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: `
      .topbar-wrapper img { content: url('https://nestjs.com/img/logo-small.svg'); width: 30px; height: 30px; }
      .swagger-ui .topbar { background-color: #2d5a27; }
    `,
  });
  
  await app.listen(port, '0.0.0.0');
  
  console.log(`🌳 ForestShield API running on port: ${port}`);
  console.log(`✅ Listening on all network interfaces (0.0.0.0)`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`📄 API Specification (JSON): http://localhost:${port}/api/docs/json`);
  console.log(`🌍 CORS enabled for dashboard development`);
}

bootstrap();
