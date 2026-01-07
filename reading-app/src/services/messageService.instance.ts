import NetworkClient from './networkClient';
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

export default messageService;
