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
exports.UsersRepository = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const surrealdb_service_1 = require("../surrealDB/surrealdb.service");
const DEFAULT_SKILLS = {
    Facts: 0,
    Inference: 0,
    Tone: 0,
    Argument: 0,
};
const hashSegment = (value) => (0, node_crypto_1.createHash)('sha256').update(value).digest('hex').slice(0, 32);
const randomId = (prefix) => `${prefix}_${(0, node_crypto_1.randomUUID)().replace(/-/g, '')}`;
const clampSkill = (value) => Math.max(0, Math.min(100, Math.round(value)));
const computeDepth = (skills) => Math.round((skills.Facts + skills.Inference + skills.Tone + skills.Argument) / 4);
let UsersRepository = class UsersRepository {
    surrealService;
    users = new Map();
    devices = new Map();
    deviceRecordIdsByDeviceId = new Map();
    documents = new Map();
    documentIdsByUser = new Map();
    progresses = new Map();
    progressIdsByUserDocument = new Map();
    masteryProfiles = new Map();
    masteryIdsByScope = new Map();
    quizAttempts = new Map();
    quizAttemptIdsByUser = new Map();
    annotations = new Map();
    annotationIdsByUser = new Map();
    constructor(surrealService) {
        this.surrealService = surrealService;
    }
    async onModuleInit() {
        if (!this.surrealService)
            return;
        await this.ensureSchema();
        await this.loadFromStore();
    }
    async ensureSchema() {
        if (!this.surrealService)
            return;
        await this.surrealService.query([
            'DEFINE TABLE IF NOT EXISTS app_user SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS user_device SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS user_document SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS reading_progress SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS mastery_profile SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS quiz_attempt SCHEMALESS;',
            'DEFINE TABLE IF NOT EXISTS annotation SCHEMALESS;',
        ].join('\n'));
    }
    async loadFromStore() {
        if (!this.surrealService)
            return;
        const [users, devices, documents, progresses, masteryProfiles, quizAttempts, annotations,] = await Promise.all([
            this.surrealService.selectTable('app_user'),
            this.surrealService.selectTable('user_device'),
            this.surrealService.selectTable('user_document'),
            this.surrealService.selectTable('reading_progress'),
            this.surrealService.selectTable('mastery_profile'),
            this.surrealService.selectTable('quiz_attempt'),
            this.surrealService.selectTable('annotation'),
        ]);
        this.clear();
        for (const user of users)
            this.indexUser(user);
        for (const device of devices)
            this.indexDevice(device);
        for (const document of documents)
            this.indexDocument(document);
        for (const progress of progresses)
            this.indexProgress(progress);
        for (const profile of masteryProfiles)
            this.indexMasteryProfile(profile);
        for (const attempt of quizAttempts)
            this.indexQuizAttempt(attempt);
        for (const annotation of annotations)
            this.indexAnnotation(annotation);
    }
    async createOrRestoreAnonymousUser(input) {
        const timestamp = new Date().toISOString();
        const existingDeviceId = this.deviceRecordIdsByDeviceId.get(input.deviceId);
        if (existingDeviceId) {
            const existingDevice = this.devices.get(existingDeviceId);
            const existingUser = existingDevice ? this.users.get(existingDevice.userId) : undefined;
            if (existingDevice && existingUser) {
                const updatedUser = {
                    ...existingUser,
                    displayName: input.displayName ?? existingUser.displayName,
                    lastSeenAt: timestamp,
                };
                const updatedDevice = {
                    ...existingDevice,
                    client: input.client,
                    lastSeenAt: timestamp,
                };
                this.indexUser(updatedUser);
                this.indexDevice(updatedDevice);
                await Promise.all([
                    this.persistRecord('app_user', updatedUser.recordId, updatedUser),
                    this.persistRecord('user_device', updatedDevice.recordId, updatedDevice),
                ]);
                return { user: updatedUser, device: updatedDevice, created: false };
            }
        }
        const user = {
            recordId: randomId('usr'),
            userId: randomId('usr'),
            type: 'anonymous',
            displayName: input.displayName,
            createdAt: timestamp,
            lastSeenAt: timestamp,
        };
        const device = {
            recordId: this.makeDeviceRecordId(input.deviceId),
            deviceId: input.deviceId,
            userId: user.userId,
            client: input.client,
            createdAt: timestamp,
            lastSeenAt: timestamp,
        };
        this.indexUser(user);
        this.indexDevice(device);
        await Promise.all([
            this.persistRecord('app_user', user.recordId, user),
            this.persistRecord('user_device', device.recordId, device),
        ]);
        return { user, device, created: true };
    }
    getUser(userId) {
        return this.users.get(userId) ?? null;
    }
    async upsertDocument(userId, input) {
        const timestamp = new Date().toISOString();
        const documentId = input.documentId ?? this.makeGeneratedDocumentId(userId, input);
        const recordId = this.makeUserDocumentRecordId(userId, documentId);
        const existing = this.documents.get(recordId);
        const record = {
            recordId,
            userId,
            documentId,
            sourceType: input.sourceType,
            title: input.title,
            author: input.author,
            url: input.url,
            contentHash: input.contentHash,
            metadata: input.metadata,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
            lastReadAt: timestamp,
        };
        this.indexDocument(record);
        await this.persistRecord('user_document', record.recordId, record);
        return record;
    }
    listDocuments(userId) {
        return Array.from(this.documentIdsByUser.get(userId) ?? [])
            .map((recordId) => this.documents.get(recordId))
            .filter((record) => Boolean(record))
            .sort((left, right) => right.lastReadAt.localeCompare(left.lastReadAt));
    }
    getDocument(userId, documentId) {
        return this.documents.get(this.makeUserDocumentRecordId(userId, documentId)) ?? null;
    }
    async patchProgress(userId, documentId, input) {
        const timestamp = new Date().toISOString();
        const recordId = this.makeProgressRecordId(userId, documentId);
        const existing = this.progresses.get(recordId);
        const completedParagraphIds = input.completedParagraphIds === undefined
            ? existing?.completedParagraphIds ?? []
            : this.sortStrings([...new Set(input.completedParagraphIds)]);
        const record = {
            recordId,
            userId,
            documentId,
            chapterId: input.chapterId ?? existing?.chapterId,
            paragraphId: input.paragraphId ?? existing?.paragraphId,
            sentenceId: input.sentenceId ?? existing?.sentenceId,
            scrollPercent: input.scrollPercent ?? existing?.scrollPercent,
            completedParagraphIds,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        };
        this.indexProgress(record);
        await this.persistRecord('reading_progress', record.recordId, record);
        return record;
    }
    getProgress(userId, documentId) {
        const existing = this.progresses.get(this.makeProgressRecordId(userId, documentId));
        if (existing)
            return existing;
        const timestamp = new Date().toISOString();
        return {
            recordId: this.makeProgressRecordId(userId, documentId),
            userId,
            documentId,
            completedParagraphIds: [],
            createdAt: timestamp,
            updatedAt: timestamp,
        };
    }
    async patchMastery(userId, input) {
        const timestamp = new Date().toISOString();
        const recordId = this.makeMasteryRecordId(userId, input.scopeType, input.scopeId);
        const existing = this.masteryProfiles.get(recordId);
        const currentSkills = existing?.skills ?? DEFAULT_SKILLS;
        const delta = input.delta ?? {};
        const skills = {
            Facts: clampSkill(currentSkills.Facts + (delta.Facts ?? 0)),
            Inference: clampSkill(currentSkills.Inference + (delta.Inference ?? 0)),
            Tone: clampSkill(currentSkills.Tone + (delta.Tone ?? 0)),
            Argument: clampSkill(currentSkills.Argument + (delta.Argument ?? 0)),
        };
        const record = {
            recordId,
            userId,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            skills,
            exp: Math.max(0, (existing?.exp ?? 0) + (delta.exp ?? 0)),
            totalAnswers: Math.max(0, (existing?.totalAnswers ?? 0) + (delta.totalAnswers ?? 0)),
            depthOfUnderstanding: computeDepth(skills),
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        };
        this.indexMasteryProfile(record);
        await this.persistRecord('mastery_profile', record.recordId, record);
        return record;
    }
    listMastery(userId, scopeType, scopeId) {
        return Array.from(this.masteryProfiles.values())
            .filter((profile) => profile.userId === userId)
            .filter((profile) => scopeType === undefined || profile.scopeType === scopeType)
            .filter((profile) => scopeId === undefined || profile.scopeId === scopeId)
            .sort((left, right) => {
            const scopeDelta = left.scopeType.localeCompare(right.scopeType);
            if (scopeDelta !== 0)
                return scopeDelta;
            return (left.scopeId ?? '').localeCompare(right.scopeId ?? '');
        });
    }
    async createQuizAttempt(userId, input) {
        const timestamp = new Date().toISOString();
        const attemptId = randomId('qat');
        const record = {
            recordId: attemptId,
            attemptId,
            userId,
            documentId: input.documentId,
            chapterId: input.chapterId,
            score: input.score,
            total: input.total,
            answers: input.answers,
            skillBreakdown: input.skillBreakdown,
            createdAt: timestamp,
        };
        this.indexQuizAttempt(record);
        await this.persistRecord('quiz_attempt', record.recordId, record);
        if (input.skillBreakdown && this.sumSkillCounts(input.skillBreakdown) > 0) {
            await this.applyQuizSkillBreakdown(userId, input.documentId, input.chapterId, input.skillBreakdown);
        }
        return record;
    }
    listQuizAttempts(userId, filters) {
        return Array.from(this.quizAttemptIdsByUser.get(userId) ?? [])
            .map((recordId) => this.quizAttempts.get(recordId))
            .filter((record) => Boolean(record))
            .filter((record) => filters.documentId === undefined || record.documentId === filters.documentId)
            .filter((record) => filters.chapterId === undefined || record.chapterId === filters.chapterId)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    }
    async upsertAnnotation(userId, input) {
        const timestamp = new Date().toISOString();
        const annotationId = input.annotationId ?? randomId('ann');
        const recordId = this.makeAnnotationRecordId(userId, annotationId);
        const existing = this.annotations.get(recordId);
        const record = {
            recordId,
            annotationId,
            userId,
            documentId: input.documentId,
            targetType: input.targetType,
            targetId: input.targetId,
            kind: input.kind,
            text: input.text,
            color: input.color,
            createdAt: existing?.createdAt ?? timestamp,
            updatedAt: timestamp,
        };
        this.indexAnnotation(record);
        await this.persistRecord('annotation', record.recordId, record);
        return record;
    }
    listAnnotations(userId, filters) {
        return Array.from(this.annotationIdsByUser.get(userId) ?? [])
            .map((recordId) => this.annotations.get(recordId))
            .filter((record) => Boolean(record))
            .filter((record) => filters.documentId === undefined || record.documentId === filters.documentId)
            .filter((record) => filters.targetType === undefined || record.targetType === filters.targetType)
            .filter((record) => filters.kind === undefined || record.kind === filters.kind)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }
    async applyQuizSkillBreakdown(userId, documentId, chapterId, skillBreakdown) {
        const correctCount = this.sumSkillCounts(skillBreakdown);
        const delta = {
            Facts: (skillBreakdown.Facts ?? 0) * 10,
            Inference: (skillBreakdown.Inference ?? 0) * 10,
            Tone: (skillBreakdown.Tone ?? 0) * 10,
            Argument: (skillBreakdown.Argument ?? 0) * 10,
            exp: correctCount * 50,
            totalAnswers: correctCount,
        };
        await this.patchMastery(userId, { scopeType: 'global', delta });
        await this.patchMastery(userId, { scopeType: 'document', scopeId: documentId, delta });
        if (chapterId) {
            await this.patchMastery(userId, { scopeType: 'chapter', scopeId: `${documentId}:${chapterId}`, delta });
        }
    }
    sumSkillCounts(skills) {
        return (skills.Facts ?? 0) + (skills.Inference ?? 0) + (skills.Tone ?? 0) + (skills.Argument ?? 0);
    }
    clear() {
        this.users.clear();
        this.devices.clear();
        this.deviceRecordIdsByDeviceId.clear();
        this.documents.clear();
        this.documentIdsByUser.clear();
        this.progresses.clear();
        this.progressIdsByUserDocument.clear();
        this.masteryProfiles.clear();
        this.masteryIdsByScope.clear();
        this.quizAttempts.clear();
        this.quizAttemptIdsByUser.clear();
        this.annotations.clear();
        this.annotationIdsByUser.clear();
    }
    indexUser(record) {
        this.users.set(record.userId, record);
    }
    indexDevice(record) {
        this.devices.set(record.recordId, record);
        this.deviceRecordIdsByDeviceId.set(record.deviceId, record.recordId);
    }
    indexDocument(record) {
        this.documents.set(record.recordId, record);
        this.addToSet(this.documentIdsByUser, record.userId, record.recordId);
    }
    indexProgress(record) {
        this.progresses.set(record.recordId, record);
        this.progressIdsByUserDocument.set(`${record.userId}:${record.documentId}`, record.recordId);
    }
    indexMasteryProfile(record) {
        this.masteryProfiles.set(record.recordId, record);
        this.masteryIdsByScope.set(this.masteryScopeKey(record.userId, record.scopeType, record.scopeId), record.recordId);
    }
    indexQuizAttempt(record) {
        this.quizAttempts.set(record.recordId, record);
        this.addToSet(this.quizAttemptIdsByUser, record.userId, record.recordId);
    }
    indexAnnotation(record) {
        this.annotations.set(record.recordId, record);
        this.addToSet(this.annotationIdsByUser, record.userId, record.recordId);
    }
    addToSet(map, key, value) {
        const current = map.get(key) ?? new Set();
        current.add(value);
        map.set(key, current);
    }
    makeDeviceRecordId(deviceId) {
        return `device_${hashSegment(deviceId)}`;
    }
    makeGeneratedDocumentId(userId, input) {
        return `doc_${hashSegment([
            userId,
            input.sourceType,
            input.contentHash ?? '',
            input.url ?? '',
            input.title,
        ].join('|'))}`;
    }
    makeUserDocumentRecordId(userId, documentId) {
        return `user_doc_${hashSegment(`${userId}|${documentId}`)}`;
    }
    makeProgressRecordId(userId, documentId) {
        return `progress_${hashSegment(`${userId}|${documentId}`)}`;
    }
    makeMasteryRecordId(userId, scopeType, scopeId) {
        return `mastery_${hashSegment(this.masteryScopeKey(userId, scopeType, scopeId))}`;
    }
    masteryScopeKey(userId, scopeType, scopeId) {
        return `${userId}|${scopeType}|${scopeId ?? ''}`;
    }
    makeAnnotationRecordId(userId, annotationId) {
        return `annotation_${hashSegment(`${userId}|${annotationId}`)}`;
    }
    sortStrings(values) {
        return values.sort((left, right) => left.localeCompare(right));
    }
    async persistRecord(table, id, record) {
        if (!this.surrealService)
            return;
        await this.surrealService.putRecord(table, id, record);
    }
};
exports.UsersRepository = UsersRepository;
exports.UsersRepository = UsersRepository = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(surrealdb_service_1.SurrealService)),
    __metadata("design:paramtypes", [surrealdb_service_1.SurrealService])
], UsersRepository);
//# sourceMappingURL=users.repository.js.map