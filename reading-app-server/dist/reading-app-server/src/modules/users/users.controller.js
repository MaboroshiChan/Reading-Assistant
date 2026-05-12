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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
let UsersController = class UsersController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    createAnonymousUser(rawBody) {
        const request = this.usersService.parseCreateAnonymousUserRequest(rawBody);
        return this.usersService.createOrRestoreAnonymousUser(request);
    }
    getUser(userId) {
        return this.usersService.getUser(userId);
    }
    upsertDocument(userId, rawBody) {
        const request = this.usersService.parseUpsertDocumentRequest(rawBody);
        return this.usersService.upsertDocument(userId, request);
    }
    listDocuments(userId) {
        return this.usersService.listDocuments(userId);
    }
    patchProgress(userId, documentId, rawBody) {
        const request = this.usersService.parsePatchProgressRequest(rawBody);
        return this.usersService.patchProgress(userId, documentId, request);
    }
    getProgress(userId, documentId) {
        return this.usersService.getProgress(userId, documentId);
    }
    patchMastery(userId, rawBody) {
        const request = this.usersService.parsePatchMasteryRequest(rawBody);
        return this.usersService.patchMastery(userId, request);
    }
    listMastery(userId, scopeType, scopeId) {
        return this.usersService.listMastery(userId, scopeType, scopeId);
    }
    createQuizAttempt(userId, rawBody) {
        const request = this.usersService.parseCreateQuizAttemptRequest(rawBody);
        return this.usersService.createQuizAttempt(userId, request);
    }
    listQuizAttempts(userId, documentId, chapterId) {
        return this.usersService.listQuizAttempts(userId, documentId, chapterId);
    }
    upsertAnnotation(userId, rawBody) {
        const request = this.usersService.parseUpsertAnnotationRequest(rawBody);
        return this.usersService.upsertAnnotation(userId, request);
    }
    listAnnotations(userId, documentId, targetType, kind) {
        return this.usersService.listAnnotations(userId, { documentId, targetType, kind });
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Post)('anonymous'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "createAnonymousUser", null);
__decorate([
    (0, common_1.Get)(':userId'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getUser", null);
__decorate([
    (0, common_1.Post)(':userId/documents'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "upsertDocument", null);
__decorate([
    (0, common_1.Get)(':userId/documents'),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "listDocuments", null);
__decorate([
    (0, common_1.Patch)(':userId/documents/:documentId/progress'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('documentId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "patchProgress", null);
__decorate([
    (0, common_1.Get)(':userId/documents/:documentId/progress'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('documentId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getProgress", null);
__decorate([
    (0, common_1.Patch)(':userId/mastery'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "patchMastery", null);
__decorate([
    (0, common_1.Get)(':userId/mastery'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('scopeType')),
    __param(2, (0, common_1.Query)('scopeId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "listMastery", null);
__decorate([
    (0, common_1.Post)(':userId/quiz-attempts'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "createQuizAttempt", null);
__decorate([
    (0, common_1.Get)(':userId/quiz-attempts'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('documentId')),
    __param(2, (0, common_1.Query)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "listQuizAttempts", null);
__decorate([
    (0, common_1.Post)(':userId/annotations'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "upsertAnnotation", null);
__decorate([
    (0, common_1.Get)(':userId/annotations'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Query)('documentId')),
    __param(2, (0, common_1.Query)('targetType')),
    __param(3, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "listAnnotations", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('v1/users'),
    __param(0, (0, common_1.Inject)(users_service_1.UsersService)),
    __metadata("design:paramtypes", [users_service_1.UsersService])
], UsersController);
//# sourceMappingURL=users.controller.js.map