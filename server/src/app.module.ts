import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { EventsModule } from './events/events.module';
import { BridgeModule } from './bridge/bridge.module';
import { MintModule } from './mint/mint.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    QueueModule,
    EventsModule,
    BridgeModule,
    MintModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
