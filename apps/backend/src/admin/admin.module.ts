import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ADMIN_CONFIG, buildAdminConfig } from './admin.config';
import { AdminController } from './admin.controller';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminGuard,
    { provide: ADMIN_CONFIG, useFactory: () => buildAdminConfig() },
  ],
})
export class AdminModule {}
