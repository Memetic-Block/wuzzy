import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EXAMPLE_QUEUE, ExampleProcessor } from './example.processor';
import { QueueController } from './queue.controller';

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullModule.registerQueue({ name: EXAMPLE_QUEUE }),
  ],
  controllers: [QueueController],
  providers: [ExampleProcessor],
  exports: [BullModule],
})
export class QueueModule {}
