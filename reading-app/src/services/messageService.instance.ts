import NetworkClient from './networkClient';
import MessageService, { type MessageServiceDefaults } from './messageService';

const baseUrl = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE_URL
  ?? 'http://localhost:8787';

const client = new NetworkClient({
  baseUrl,
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
