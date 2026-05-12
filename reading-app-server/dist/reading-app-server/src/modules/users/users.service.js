"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const users_repository_1 = require("./users.repository");
const VALID_CLIENTS = new Set(['ios', 'web', 'extension']);
const VALID_SCOPE_TYPES = new Set(['global', 'document', 'chapter']);
const VALID_ANNOTATION_KINDS = new Set(['note', 'bookmark', 'highlight']);
const SKILL_KEYS = ['Facts', 'Inference', 'Tone', 'Argument'];
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
let UsersService = class UsersService {
    usersRepository;
    constructor(usersRepository) {
        this.usersRepository = usersRepository;
    }
    parseCreateAnonymousUserRequest(rawBody) {
        const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
        const client = this.requireEnum(parsed.client, 'client', VALID_CLIENTS);
        return {
            deviceId: this.requireString(parsed.deviceId, 'deviceId'),
            client,
            displayName: this.optionalString(parsed.displayName, 'displayName'),
        };
    }
    async createOrRestoreAnonymousUser(input) {
        const result = await this.usersRepository.createOrRestoreAnonymousUser(input);
        return {
            userId: result.user.userId,
            deviceId: result.device.deviceId,
            type: result.user.type,
            createdAt: result.user.createdAt,
            lastSeenAt: result.user.lastSeenAt,
        };
    }
    getUser(userId) {
        return this.requireUser(userId);
    }
    parseUpsertDocumentRequest(rawBody) {
        const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
        return {
            documentId: this.optionalString(parsed.documentId, 'documentId'),
            sourceType: this.requireString(parsed.sourceType, 'sourceType'),
            title: this.requireString(parsed.title, 'title'),
            author: this.optionalString(parsed.author, 'author'),
            url: this.optionalString(parsed.url, 'url'),
            contentHash: this.optionalString(parsed.contentHash, 'contentHash'),
            metadata: this.optionalObject(parsed.metadata, 'metadata'),
        };
    }
    async upsertDocument(userId, input) {
        this.requireUser(userId);
        return this.usersRepository.upsertDocument(userId, input);
    }
    listDocuments(userId) {
        this.requireUser(userId);
        return this.usersRepository.listDocuments(userId);
    }
    parsePatchProgressRequest(rawBody) {
        const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
        return {
            chapterId: this.optionalString(parsed.chapterId, 'chapterId'),
            paragraphId: this.optionalString(parsed.paragraphId, 'paragraphId'),
            sentenceId: this.optionalString(parsed.sentenceId, 'sentenceId'),
            scrollPercent: this.optionalPercent(parsed.scrollPercent, 'scrollPercent'),
            completedParagraphIds: this.optionalStringArray(parsed.completedParagraphIds, 'completedParagraphIds'),
        };
    }
    async patchProgress(userId, documentId, input) {
        this.requireUser(userId);
        this.requireDocument(userId, documentId);
        return this.usersRepository.patchProgress(userId, documentId, input);
    }
    getProgress(userId, documentId) {
        this.requireUser(userId);
        this.requireDocument(userId, documentId);
        return this.usersRepository.getProgress(userId, documentId);
    }
    parsePatchMasteryRequest(rawBody) {
        const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
        const scopeType = this.requireEnum(parsed.scopeType, 'scopeType', VALID_SCOPE_TYPES);
        const scopeId = this.optionalString(parsed.scopeId, 'scopeId');
        if (scopeType !== 'global' && !scopeId) {
            throw new common_1.BadRequestException('scopeId is required for document and chapter mastery scopes');
        }
        let delta;
        if (parsed.delta !== undefined) {
            if (!isPlainObject(parsed.delta)) {
                throw new common_1.BadRequestException('delta must be a JSON object when provided');
            }
            delta = {};
            for (const key of SKILL_KEYS) {
                const value = parsed.delta[key];
                if (value !== undefined)
                    delta[key] = this.requireNumber(value, `delta.${key}`);
            }
            if (parsed.delta.exp !== undefined)
                delta.exp = this.requireNumber(parsed.delta.exp, 'delta.exp');
            if (parsed.delta.totalAnswers !== undefined) {
                delta.totalAnswers = this.requireNumber(parsed.delta.totalAnswers, 'delta.totalAnswers');
            }
        }
        return { scopeType, scopeId, delta };
    }
    async patchMastery(userId, input) {
        this.requireUser(userId);
        return this.usersRepository.patchMastery(userId, input);
    }
    listMastery(userId, rawScopeType, rawScopeId) {
        this.requireUser(userId);
        const scopeType = rawScopeType === undefined || rawScopeType.trim() === ''
            ? undefined
            : this.requireEnum(rawScopeType, 'scopeType', VALID_SCOPE_TYPES);
        const scopeId = rawScopeId === undefined || rawScopeId.trim() === '' ? undefined : rawScopeId;
        return this.usersRepository.listMastery(userId, scopeType, scopeId);
    }
    parseCreateQuizAttemptRequest(rawBody) {
        const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
        const score = this.requireNumber(parsed.score, 'score');
        const total = this.requireNumber(parsed.total, 'total');
        if (!Number.isInteger(score) || score < 0) {
            throw new common_1.BadRequestException('score must be a non-negative integer');
        }
        if (!Number.isInteger(total) || total < 0) {
            throw new common_1.BadRequestException('total must be a non-negative integer');
        }
        if (score > total) {
            throw new common_1.BadRequestException('score cannot be greater than total');
        }
        if (!Array.isArray(parsed.answers)) {
            throw new common_1.BadRequestException('answers must be an array');
        }
        return {
            documentId: this.requireString(parsed.documentId, 'documentId'),
            chapterId: this.optionalString(parsed.chapterId, 'chapterId'),
            score,
            total,
            answers: parsed.answers,
            skillBreakdown: this.optionalSkillBreakdown(parsed.skillBreakdown),
        };
    }
    async createQuizAttempt(userId, input) {
        this.requireUser(userId);
        this.requireDocument(userId, input.documentId);
        return this.usersRepository.createQuizAttempt(userId, input);
    }
    listQuizAttempts(userId, documentId, chapterId) {
        this.requireUser(userId);
        return this.usersRepository.listQuizAttempts(userId, {
            documentId: documentId && documentId.trim() !== '' ? documentId : undefined,
            chapterId: chapterId && chapterId.trim() !== '' ? chapterId : undefined,
        });
    }
    parseUpsertAnnotationRequest(rawBody) {
        const parsed = this.parseBody(rawBody, 'Request body cannot be empty');
        return {
            annotationId: this.optionalString(parsed.annotationId, 'annotationId'),
            documentId: this.requireString(parsed.documentId, 'documentId'),
            targetType: this.requireString(parsed.targetType, 'targetType'),
            targetId: this.requireString(parsed.targetId, 'targetId'),
            kind: this.requireEnum(parsed.kind, 'kind', VALID_ANNOTATION_KINDS),
            text: this.optionalString(parsed.text, 'text'),
            color: this.optionalString(parsed.color, 'color'),
        };
    }
    async upsertAnnotation(userId, input) {
        this.requireUser(userId);
        this.requireDocument(userId, input.documentId);
        return this.usersRepository.upsertAnnotation(userId, input);
    }
    listAnnotations(userId, filters) {
        this.requireUser(userId);
        return this.usersRepository.listAnnotations(userId, {
            documentId: filters.documentId && filters.documentId.trim() !== '' ? filters.documentId : undefined,
            targetType: filters.targetType && filters.targetType.trim() !== '' ? filters.targetType : undefined,
            kind: filters.kind && filters.kind.trim() !== '' ? filters.kind : undefined,
        });
    }
    requireUser(userId) {
        const user = this.usersRepository.getUser(userId);
        if (!user) {
            throw new common_1.NotFoundException(`User not found: ${userId}`);
        }
        return user;
    }
    requireDocument(userId, documentId) {
        const document = this.usersRepository.getDocument(userId, documentId);
        if (!document) {
            throw new common_1.NotFoundException(`Document not found for user: ${documentId}`);
        }
        return document;
    }
    parseBody(rawBody, emptyMessage) {
        if (!rawBody || rawBody.trim() === '') {
            throw new common_1.BadRequestException(emptyMessage);
        }
        let parsed;
        try {
            parsed = JSON.parse(rawBody);
        }
        catch (error) {
            throw new common_1.BadRequestException(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
        if (!isPlainObject(parsed)) {
            throw new common_1.BadRequestException('Request body must be a JSON object');
        }
        return parsed;
    }
    requireString(value, fieldName) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new common_1.BadRequestException(`${fieldName} must be a non-empty string`);
        }
        return value.trim();
    }
    optionalString(value, fieldName) {
        if (value === undefined || value === null)
            return undefined;
        return this.requireString(value, fieldName);
    }
    optionalObject(value, fieldName) {
        if (value === undefined || value === null)
            return undefined;
        if (!isPlainObject(value)) {
            throw new common_1.BadRequestException(`${fieldName} must be a JSON object when provided`);
        }
        return { ...value };
    }
    requireEnum(value, fieldName, allowed) {
        const text = this.requireString(value, fieldName);
        if (!allowed.has(text)) {
            throw new common_1.BadRequestException(`${fieldName} must be one of: ${Array.from(allowed).join(', ')}`);
        }
        return text;
    }
    requireNumber(value, fieldName) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            throw new common_1.BadRequestException(`${fieldName} must be a finite number`);
        }
        return value;
    }
    optionalPercent(value, fieldName) {
        if (value === undefined || value === null)
            return undefined;
        const numberValue = this.requireNumber(value, fieldName);
        if (numberValue < 0 || numberValue > 100) {
            throw new common_1.BadRequestException(`${fieldName} must be between 0 and 100`);
        }
        return numberValue;
    }
    optionalStringArray(value, fieldName) {
        if (value === undefined || value === null)
            return undefined;
        if (!Array.isArray(value)) {
            throw new common_1.BadRequestException(`${fieldName} must be an array`);
        }
        return value.map((entry, index) => this.requireString(entry, `${fieldName}.${index}`));
    }
    optionalSkillBreakdown(value) {
        if (value === undefined || value === null)
            return undefined;
        if (!isPlainObject(value)) {
            throw new common_1.BadRequestException('skillBreakdown must be a JSON object when provided');
        }
        const result = {};
        for (const key of SKILL_KEYS) {
            if (value[key] === undefined)
                continue;
            const numberValue = this.requireNumber(value[key], `skillBreakdown.${key}`);
            if (!Number.isInteger(numberValue) || numberValue < 0) {
                throw new common_1.BadRequestException(`skillBreakdown.${key} must be a non-negative integer`);
            }
            result[key] = numberValue;
        }
        return result;
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(users_repository_1.UsersRepository)),
    __metadata("design:paramtypes", [users_repository_1.UsersRepository])
], UsersService);
//# sourceMappingURL=users.service.js.map