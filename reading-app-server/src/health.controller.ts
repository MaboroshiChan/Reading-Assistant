import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';

@Controller()
export class HealthController {
  @Get('ping')
  ping(@Req() req: Request): { status: string; serverTime: string } {
    const remote = req.socket.remoteAddress ?? 'unknown';
    console.log(`[server] ping received from ${remote} @ ${new Date().toISOString()}`);
    return {
      status: 'ok',
      serverTime: new Date().toISOString(),
    };
  }
}
