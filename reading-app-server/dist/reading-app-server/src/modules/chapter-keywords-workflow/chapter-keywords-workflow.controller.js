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
exports.ChapterKeywordsWorkflowController = void 0;
const common_1 = require("@nestjs/common");
const chapter_keywords_workflow_service_1 = require("./chapter-keywords-workflow.service");
let ChapterKeywordsWorkflowController = class ChapterKeywordsWorkflowController {
    chapterKeywordsWorkflowService;
    constructor(chapterKeywordsWorkflowService) {
        this.chapterKeywordsWorkflowService = chapterKeywordsWorkflowService;
    }
    submitChapterKeywordsWorkflow(rawBody) {
        const request = this.chapterKeywordsWorkflowService.parseSubmitRequest(rawBody);
        return this.chapterKeywordsWorkflowService.submitChapterKeywordsWorkflow(request);
    }
    getWorkflowStatus(workflowRunId) {
        return this.chapterKeywordsWorkflowService.getWorkflowStatus(workflowRunId);
    }
    getWorkflowResult(workflowRunId) {
        return this.chapterKeywordsWorkflowService.getWorkflowResult(workflowRunId);
    }
    getLatestChapterKeywords(bookId, chapterId) {
        return this.chapterKeywordsWorkflowService.getLatestChapterKeywords(bookId, chapterId);
    }
};
exports.ChapterKeywordsWorkflowController = ChapterKeywordsWorkflowController;
__decorate([
    (0, common_1.Post)('workflows/chapter-keywords'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "submitChapterKeywordsWorkflow", null);
__decorate([
    (0, common_1.Get)('workflows/chapter-keywords/:workflowRunId'),
    __param(0, (0, common_1.Param)('workflowRunId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "getWorkflowStatus", null);
__decorate([
    (0, common_1.Get)('workflows/chapter-keywords/:workflowRunId/result'),
    __param(0, (0, common_1.Param)('workflowRunId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "getWorkflowResult", null);
__decorate([
    (0, common_1.Get)('books/:bookId/chapters/:chapterId/chapter-keywords'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "getLatestChapterKeywords", null);
exports.ChapterKeywordsWorkflowController = ChapterKeywordsWorkflowController = __decorate([
    (0, common_1.Controller)('v1'),
    __param(0, (0, common_1.Inject)(chapter_keywords_workflow_service_1.ChapterKeywordsWorkflowService)),
    __metadata("design:paramtypes", [chapter_keywords_workflow_service_1.ChapterKeywordsWorkflowService])
], ChapterKeywordsWorkflowController);
//# sourceMappingURL=chapter-keywords-workflow.controller.js.map