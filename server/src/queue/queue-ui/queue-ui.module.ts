import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { QueueUIController } from './queue-ui.controller';
import { QueueUIService } from './queue-ui.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'bridge' },
      { name: 'gelato-status' },
      { name: 'gelato-recovery' },
    ),
  ],
  controllers: [QueueUIController],
  providers: [QueueUIService],
})
export class QueueUIModule {}
