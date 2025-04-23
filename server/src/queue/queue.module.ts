import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BridgeProcessor } from './bridge.processor';
import { GelatoStatusProcessor } from './gelato-status.processor';
import { BridgeModule } from '../bridge/bridge.module';
import { QueueUIModule } from './queue-ui/queue-ui.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get('REDIS_HOST'),
          port: configService.get('REDIS_PORT'),
        },
      }),
    }),
    BullModule.registerQueue(
      { name: 'bridge' },
      { name: 'gelato-status' },
      { name: 'gelato-recovery' },
    ),
    BridgeModule,
    QueueUIModule,
  ],
  providers: [BridgeProcessor, GelatoStatusProcessor],
  exports: [BullModule],
})
export class QueueModule {}
