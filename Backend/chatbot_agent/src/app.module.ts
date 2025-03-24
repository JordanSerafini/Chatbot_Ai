import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModelModule } from './model_ai/model.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ModelModule,
  ],
})
export class AppModule {}
