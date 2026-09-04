import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PAYMENT_CONFIG, buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    PaymentService,
    { provide: PAYMENT_CONFIG, useFactory: () => buildPaymentConfig() },
  ],
})
export class SearchModule {}
