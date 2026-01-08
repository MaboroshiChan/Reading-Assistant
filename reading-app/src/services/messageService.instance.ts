import NetworkClient from './networkClient';
import StreamingNetworkClient from './streamingNetworkClient';
import MessageService, { type MessageServiceDefaults } from './messageService';
import { config } from './config';

const client = new NetworkClient({
  baseUrl: config.apiBaseUrl,
  apiPath: '/msg',
  defaultHeaders: {
    'X-App-Client': 'reading-app',
  },
});

const defaults: MessageServiceDefaults = {
  locale: 'en-US',
  clientInfo: {
    app: 'reading-app',
    platform: 'web',
    version: '0.1.0',
  },
  promptVersion: 'p1',
  modelTier: 'mid',
  defaultPriority: 'normal',
  defaultCacheHint: 'prefer',
};

export const messageService = new MessageService(client, defaults);

const streamingClient = new StreamingNetworkClient({
  baseUrl: config.apiBaseUrl,
  apiPath: '/stream',
  defaultHeaders: {
    'X-App-Client': 'reading-app',
  },
});

export const streamingMessageService = new MessageService(streamingClient, defaults);

export default messageService;