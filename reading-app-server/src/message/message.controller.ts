import { Body, Controller, Inject, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { extractJsonFromText } from '../../services/llmService';
import { MessageService } from './message.service';

@Controller()
export class MessageController {
  constructor(
    @Inject(MessageService)
    private readonly messageService: MessageService,
  ) {}

  @Post('msg')
  async handleMsg(@Body() rawBody: string | undefined, @Res() res: Response): Promise<void> {
    const result = await this.messageService.handleMsg(rawBody ?? '');

    if (result.stream) {
      let text = '';
      for await (const chunk of result.stream) {
        text += chunk;
      }

      let parsed: unknown;
      try {
        parsed = extractJsonFromText(text);
      } catch (error) {
        console.error('Failed to parse stream output', error);
        parsed = { _raw_error: text };
      }

      if (parsed && typeof parsed === 'object' && 'status' in parsed && 'request_id' in parsed) {
        res.setHeader('Content-Type', 'application/json');
        res.status(200).send(JSON.stringify(parsed));
        return;
      }

      const usage = await result.usage;
      const buffered = {
        ...result,
        stream: undefined,
        served_from: 'fresh' as const,
        data: parsed,
        usage,
      };
      res.setHeader('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(buffered));
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    const statusCode = result.status === 'error'
      ? result.error?.http ?? 500
      : 200;
    res.status(statusCode).send(JSON.stringify(result));
  }

  @Post('stream')
  async handleStream(@Body() rawBody: string | undefined, @Res() res: Response): Promise<void> {
    const result = await this.messageService.handleStream(rawBody ?? '');

    if ('status' in result && result.status === 'error') {
      res.setHeader('Content-Type', 'application/json');
      res.status(result.error?.http ?? 500).send(JSON.stringify(result));
      return;
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200);
    if (result.stream) {
      for await (const chunk of result.stream) {
        res.write(chunk);
      }
    }
    res.end();
  }
}
