import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import NetworkClient from '../../src/services/networkClient';
import StreamingNetworkClient from '../../src/services/streamingNetworkClient';

// 1. Mock dependencies before importing the module under test
jest.mock('../../src/services/networkClient');
jest.mock('../../src/services/streamingNetworkClient');
jest.mock('../../src/services/config', () => ({
  config: { apiBaseUrl: 'http://localhost:8787' },
}));

// 2. Import the module under test
// Note: Because jest.mock is hoisted, clients are already mocked when this runs.
import { messageService, streamingMessageService } from '../../src/services/messageService.instance';

describe('MessageService Instances', () => {
  // Access the mocked class to inspect constructor calls
  const MockNetworkClient = NetworkClient as jest.MockedClass<typeof NetworkClient>;
  const MockStreamingNetworkClient = StreamingNetworkClient as jest.MockedClass<typeof StreamingNetworkClient>;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clear specific spies on the singleton instances' clients if they exist
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stdClient = (messageService as any).client;
    if (stdClient?.send) stdClient.send.mockClear();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const streamClient = (streamingMessageService as any).client;
    if (streamClient?.send) streamClient.send.mockClear();
  });

  describe('Standard messageService', () => {
    it('should be initialized with NetworkClient and /msg endpoint', () => {
      // Check calls to the NetworkClient constructor
      const calls = MockNetworkClient.mock.calls;
      const initArgs = calls.find(args => args[0].apiPath === '/msg');

      expect(initArgs).toBeDefined();
      expect(initArgs?.[0]).toMatchObject({
        baseUrl: 'http://localhost:8787',
        apiPath: '/msg',
        defaultHeaders: { 'X-App-Client': 'reading-app' },
      });
    });

    it('should use the standard client for requests', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (messageService as any).client;
      client.send.mockResolvedValue({ status: 'ok', request_id: 'req-std' });

      await messageService.analyzeParagraph(
        { doc_id: 'd1', paragraph_id: 'p1', paragraph_text: 'text' },
        { doc: { doc_id: 'd1', content_hash: 'h1' } }
      );

      expect(client.send).toHaveBeenCalledTimes(1);
      const [envelope] = client.send.mock.calls[0];
      expect(envelope.stream).toBeUndefined();
    });
  });

  describe('streamingMessageService', () => {
    it('should be initialized with StreamingNetworkClient and /stream endpoint', () => {
      // Check calls to the StreamingNetworkClient constructor
      const calls = MockStreamingNetworkClient.mock.calls;
      const initArgs = calls.find(args => args[0].apiPath === '/stream');

      expect(initArgs).toBeDefined();
      expect(initArgs?.[0]).toMatchObject({
        baseUrl: 'http://localhost:8787',
        apiPath: '/stream',
        defaultHeaders: { 'X-App-Client': 'reading-app' },
      });
    });

    it('should set stream=true in the envelope when onFrame is provided', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (streamingMessageService as any).client;
      client.send.mockResolvedValue({ status: 'ok', request_id: 'req-stream-1' });

      const onFrame = jest.fn();
      const payload = { doc_id: 'd1', paragraph_id: 'p1', paragraph_text: 'text' };
      const context = { doc: { doc_id: 'd1', content_hash: 'h1' } };

      await streamingMessageService.analyzeParagraph(payload, context, { onFrame });

      expect(client.send).toHaveBeenCalledTimes(1);
      const [envelope, options] = client.send.mock.calls[0];

      expect(envelope.stream).toBe(true);
      expect(options.onFrame).toBe(onFrame);
    });

    it('should NOT set stream=true when onFrame is missing', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const client = (streamingMessageService as any).client;
      client.send.mockResolvedValue({ status: 'ok', request_id: 'req-2' });

      const payload = { doc_id: 'd1', paragraph_id: 'p1', paragraph_text: 'text' };
      const context = { doc: { doc_id: 'd1', content_hash: 'h1' } };

      await streamingMessageService.analyzeParagraph(payload, context);

      const [envelope] = client.send.mock.calls[0];
      expect(envelope.stream).toBeUndefined();
    });
  });
});