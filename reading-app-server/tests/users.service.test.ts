import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, test } from 'vitest';
import { UsersRepository } from '../src/modules/users/users.repository';
import { UsersService } from '../src/modules/users/users.service';

describe('UsersService', () => {
  const createService = (): UsersService => new UsersService(new UsersRepository());

  test('rejects invalid anonymous user requests', () => {
    const service = createService();

    expect(() => service.parseCreateAnonymousUserRequest('')).toThrowError(BadRequestException);
    expect(() => service.parseCreateAnonymousUserRequest(JSON.stringify({
      deviceId: '',
      client: 'ios',
    }))).toThrowError('deviceId must be a non-empty string');
    expect(() => service.parseCreateAnonymousUserRequest(JSON.stringify({
      deviceId: 'device-1',
      client: 'desktop',
    }))).toThrowError('client must be one of: ios, web, extension');
  });

  test('throws not found for unknown users', () => {
    const service = createService();

    expect(() => service.getUser('missing-user')).toThrowError(NotFoundException);
  });

  test('parses mastery and quiz requests', () => {
    const service = createService();

    expect(service.parsePatchMasteryRequest(JSON.stringify({
      scopeType: 'document',
      scopeId: 'doc-1',
      delta: {
        Facts: 10,
        exp: 50,
      },
    }))).toMatchObject({
      scopeType: 'document',
      scopeId: 'doc-1',
      delta: {
        Facts: 10,
        exp: 50,
      },
    });

    expect(() => service.parsePatchMasteryRequest(JSON.stringify({
      scopeType: 'chapter',
    }))).toThrowError('scopeId is required for document and chapter mastery scopes');

    expect(service.parseCreateQuizAttemptRequest(JSON.stringify({
      documentId: 'doc-1',
      score: 1,
      total: 2,
      answers: [],
      skillBreakdown: {
        Facts: 1,
      },
    }))).toMatchObject({
      documentId: 'doc-1',
      score: 1,
      total: 2,
      skillBreakdown: {
        Facts: 1,
      },
    });

    expect(() => service.parseCreateQuizAttemptRequest(JSON.stringify({
      documentId: 'doc-1',
      score: 3,
      total: 2,
      answers: [],
    }))).toThrowError('score cannot be greater than total');
  });
});
