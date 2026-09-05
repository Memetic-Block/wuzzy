import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { createEmbedder } from '../embed/embedder';
import { IndexesModule } from '../indexes/indexes.module';
import { PAYMENT_CONFIG, buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { SearchController } from './search.controller';
import { SEARCH_CONFIG, buildSearchConfig } from './search.config';
import { EMBEDDER, SearchService } from './search.service';

@Module({
  imports: [DatabaseModule, IndexesModule],
  controllers: [SearchController],
  providers: [
    SearchService,
    PaymentService,
    { provide: PAYMENT_CONFIG, useFactory: () => buildPaymentConfig() },
    { provide: SEARCH_CONFIG, useFactory: () => buildSearchConfig() },
    { provide: EMBEDDER, useFactory: () => createEmbedder() },
  ],
})
export class SearchModule {}
