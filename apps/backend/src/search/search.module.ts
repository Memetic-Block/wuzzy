import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PAYMENT_CONFIG, buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { createEmbedder } from '../embed/embedder';
import { SearchController } from './search.controller';
import { EMBEDDER, SearchService } from './search.service';

@Module({
  imports: [DatabaseModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    PaymentService,
    { provide: PAYMENT_CONFIG, useFactory: () => buildPaymentConfig() },
    { provide: EMBEDDER, useFactory: () => createEmbedder() },
  ],
})
export class SearchModule {}
