import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SentinelModule } from './sentinel/sentinel.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    HttpModule,
    SentinelModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
