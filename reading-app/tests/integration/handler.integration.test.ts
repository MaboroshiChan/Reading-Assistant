import '../../src/setup/env';
import { describe, expect, test } from 'vitest';
import MessageService from '../../src/services/messageService';
import NetworkClient from '../../src/services/networkClient';

describe('handler test', () => {
    const client = new NetworkClient({
        baseUrl: process.env.LIVE_SERVER_URL ?? 'http://localhost:8787'
    });

    const service = new MessageService(client);
    
})