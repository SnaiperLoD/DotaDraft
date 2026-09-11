import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthSessionMiddleware } from './auth.middleware';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthSessionMiddleware],
  exports: [AuthService, AuthSessionMiddleware],
})
export class AuthModule {}
