import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { extractJsonFromText } from '../../services/llmService';
import { MessageService } from './message.service';
import { createAbortError, isAbortError } from '../utils/abort';

@Controller()
export class MessageController {
  constructor(
    @Inject(MessageService)
    private readonly messageService: MessageService,
  ) {}

  private createRequestAbortController(req: Request, res: Response): {
    signal: AbortSignal;
    cleanup: () => void;
  } {
    const abortController = new AbortController();
    const abortRequest = (): void => {
      if (!abortController.signal.aborted) {
        abortController.abort(createAbortError('Client disconnected'));
      }
    };
    const abortOnClose = (): void => {
      if (!res.writableEnded) {
        abortRequest();
      }
    };

    req.once('aborted', abortRequest);
    res.once('close', abortOnClose);

    return {
      signal: abortController.signal,
      cleanup: () => {
        req.off('aborted', abortRequest);
        res.off('close', abortOnClose);
      },
    };
  }

  @Post('msg')
  async handleMsg(
    @Body() rawBody: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { signal, cleanup } = this.createRequestAbortController(req, res);

    try {
      const result = await this.messageService.handleMsg(rawBody ?? '', signal);

      if (result.stream) {
        let text = '';
        for await (const chunk of result.stream) {
          text += chunk;
        }
        if (signal.aborted || res.destroyed) return;

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
        if (signal.aborted || res.destroyed) return;
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
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    } finally {
      cleanup();
    }
  }

  @Post('stream')
  async handleStream(
    @Body() rawBody: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { signal, cleanup } = this.createRequestAbortController(req, res);

    try {
      const result = await this.messageService.handleStream(rawBody ?? '', signal);

      if ('status' in result && result.status === 'error') {
        if (signal.aborted || res.destroyed) return;
        res.setHeader('Content-Type', 'application/json');
        res.status(result.error?.http ?? 500).send(JSON.stringify(result));
        return;
      }

      res.setHeader('Content-Type', 'application/json');
      res.status(200);
      if (result.stream) {
        for await (const chunk of result.stream) {
          if (signal.aborted || res.destroyed) return;
          res.write(chunk);
        }
      }
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    } finally {
      cleanup();
    }
  }
}
