import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { createEmbedder } from '../embed/embedder';
import { IndexesModule } from '../indexes/indexes.module';
import { PAYMENT_CONFIG, buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { SearchController } from './search.controller';
import { SEARCH_CONFIG, buildSearchConfig } from './search.config';
import { EMBEDDER, SearchService } from './search.service';
import { WebSearchController } from './web-search.controller';
import { WEB_SEARCH_CONFIG, buildWebSearchConfig } from './web-search.config';

@Module({
  imports: [DatabaseModule, IndexesModule],
  controllers: [SearchController, WebSearchController],
  providers: [
    SearchService,
    PaymentService,
    { provide: PAYMENT_CONFIG, useFactory: () => buildPaymentConfig() },
    { provide: SEARCH_CONFIG, useFactory: () => buildSearchConfig() },
    { provide: WEB_SEARCH_CONFIG, useFactory: () => buildWebSearchConfig() },
    { provide: EMBEDDER, useFactory: () => createEmbedder() },
  ],
})
export class SearchModule {}
