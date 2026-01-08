import test, { describe } from 'node:test';
import {streamingMessageService} from '../../src/services/messageService.instance';

describe('streamingMessageService', () => {
    test('example', async () => {
        streamingMessageService.ping().then(console.log);
    })
})