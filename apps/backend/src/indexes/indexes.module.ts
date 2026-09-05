import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PAYMENT_CONFIG, buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { INDEXES_CONFIG, buildIndexesConfig } from './index.config';
import { IndexesController } from './indexes.controller';
import { IndexesService } from './indexes.service';

@Module({
  imports: [DatabaseModule],
  controllers: [IndexesController],
  providers: [
    IndexesService,
    PaymentService,
    { provide: PAYMENT_CONFIG, useFactory: () => buildPaymentConfig() },
    { provide: INDEXES_CONFIG, useFactory: () => buildIndexesConfig() },
  ],
  exports: [IndexesService],
})
export class IndexesModule {}
