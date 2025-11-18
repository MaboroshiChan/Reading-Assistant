import { describe, expect, test } from 'vitest';
import MessageService from '../../src/services/messageService';
import NetworkClient from '../../src/services/networkClient';

const LIVE_SERVER_URL = process.env.LIVE_SERVER_URL ?? 'http://localhost:8787';


const shouldRun = process.env.LIVE_PING === '1';

describe.skipIf(!shouldRun)('Live server ping', () => {
  test('MessageService.ping reaches live backend', async () => {
    const client = new NetworkClient({ baseUrl: LIVE_SERVER_URL });
    const service = new MessageService(client);

    const result = await service.ping();

    expect(result.status).toBe('ok');
    expect(result.serverTime).toBeDefined();
  });
});
