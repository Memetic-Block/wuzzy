import { Module } from '@nestjs/common';
import { INDEXES_CONFIG, buildIndexesConfig } from '../indexes/index.config';
import { PAYMENT_CONFIG, buildPaymentConfig } from '../payment/payment.config';
import { PaymentService } from '../payment/payment.service';
import { DISCOVERY_CONFIG, buildDiscoveryConfig } from './discovery.config';
import { LlmsController } from './llms.controller';

/**
 * Publishes what the API is and what it costs, in the one format an agent can
 * read without parsing markup.
 *
 * It takes the meter as a collaborator rather than a copy of its numbers: the
 * controller asks PaymentService for a quote and prints the answer, so there
 * is no second place a price could be configured.
 */
@Module({
  controllers: [LlmsController],
  providers: [
    PaymentService,
    { provide: PAYMENT_CONFIG, useFactory: () => buildPaymentConfig() },
    { provide: INDEXES_CONFIG, useFactory: () => buildIndexesConfig() },
    { provide: DISCOVERY_CONFIG, useFactory: () => buildDiscoveryConfig() },
  ],
})
export class DiscoveryModule {}
