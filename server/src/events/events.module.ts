import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { BlockchainListenerService } from './blockchain-listener.service';
import { BridgeModule } from '../bridge/bridge.module';

@Module({
  imports: [
    BridgeModule,
    BullModule.registerQueue({
      name: 'bridge',
    }),
  ],
  providers: [BlockchainListenerService],
  exports: [BlockchainListenerService],
})
export class EventsModule {}
