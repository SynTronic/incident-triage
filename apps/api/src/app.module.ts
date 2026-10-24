import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { UploadsModule } from './uploads/uploads.module';

@Module({
  imports: [UploadsModule],
  controllers: [HealthController],
})
export class AppModule {}
