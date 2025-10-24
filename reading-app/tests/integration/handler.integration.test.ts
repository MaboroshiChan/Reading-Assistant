import { describe, expect, test } from 'vitest';
import MessageService from '../../src/services/messageService';
import NetworkClient from '../../src/services/networkClient';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

// Ensure browser-like crypto is available for MessageService request ids.
if (!globalThis.crypto) {
    globalThis.crypto = webcrypto as unknown as Crypto;
}

const baseUrl = process.env.LIVE_SERVER_URL ?? 'http://localhost:8787';

if (!baseUrl) {
    describe.skip('handler test', () => {
        test.skip('requires LIVE_SERVER_URL', () => {});
    });
} else {
    describe('handler test', () => {
        const client = new NetworkClient({ baseUrl });
        const service = new MessageService(client);

        test('ping responds before running paragraph tests', async () => {
            const result = await service.ping();
            expect(result.status).toBe('ok');
        });

        const candidatePaths = [
            resolve(process.cwd(), 'resource/examples/paragraph_a.md'),
            resolve(__dirname, '../../../resource/examples/paragraph_a.md'),
        ];
        const examplePath = candidatePaths.find(path => existsSync(path));
        if (!examplePath) {
            throw new Error('Unable to locate resource/examples/paragraph_a.md');
        }

        const rawMarkdown = readFileSync(examplePath, 'utf8');
        const paragraphText = rawMarkdown
            .replace(/\r\n/g, '\n')
            .split(/\n{2,}/)
            .map(block => block.trim())
            .filter(Boolean)
            .find(block => !block.startsWith('#')) ?? '';

        if (!paragraphText) {
            throw new Error('Sample paragraph could not be extracted from paragraph_a.md');
        }

        test('paragraph test 1', async () => {
            const payload = {
                doc_id: 'doc-1',
                paragraph_id: 'paragraph_a',
                paragraph_text: paragraphText,
            };

            const ctx = {
                doc: {
                    doc_id: payload.doc_id,
                    content_hash: 'hash-paragraph-a',
                },
            };

            const response = await service.analyzeParagraph(payload, ctx);
            expect(response.request_id).toBeDefined();
            expect(response.status).toBe('ok');
            expect(response.data?.summary && response.data.summary.length).toBeGreaterThan(0);
            expect(response.data?.roles?.length).toBeGreaterThan(0);
            expect(response.data?.claims?.length).toBeGreaterThan(0);
            expect(response.data?.anchors?.length).toBeGreaterThan(0);
        })
    });
}
