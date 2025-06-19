import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS for dashboard UI development
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001', 
      'http://localhost:4200', // Angular
      'http://localhost:5173', // Vite
      'http://localhost:8080', // Vue
      /^https:\/\/.*\.vercel\.app$/, // Vercel deployments
      /^https:\/\/.*\.netlify\.app$/, // Netlify deployments
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

  // Swagger API documentation setup
  const config = new DocumentBuilder()
    .setTitle('ForestShield API')
    .setDescription('AWS-powered deforestation detection using Sentinel-2 satellite imagery')
    .setVersion('1.0.0')
    .setContact(
      'ForestShield Team',
      'https://github.com/forestshield',
      'contact@forestshield.com'
    )
    .setLicense('MIT', 'https://opensource.org/licenses/MIT')
    .addTag('dashboard', 'Dashboard overview and statistics')
    .addTag('monitoring', 'Real-time monitoring and alerts')
    .addTag('regions', 'Geographic region management')
    .addTag('analysis', 'Deforestation analysis and processing')
    .addTag('historical', 'Historical data and trends')
    .addTag('system', 'System health and configuration')
    .build();

  const document = SwaggerModule.createDocument(app, config);
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

  const port = process.env.PORT ?? 3000;
  
  await app.listen(port);
  
  console.log(`🌳 ForestShield API running on: http://localhost:${port}`);
  console.log(`📚 API Documentation: http://localhost:${port}/api/docs`);
  console.log(`🌍 CORS enabled for dashboard development`);
}

bootstrap();
