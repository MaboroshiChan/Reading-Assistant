import { Injectable } from '@nestjs/common';
import { handleMsg, handleStream } from '../../http/router';

@Injectable()
export class MessageHttpService {
  handleMsg(raw: string) {
    return handleMsg(raw);
  }

  handleStream(raw: string) {
    return handleStream(raw);
  }
}
