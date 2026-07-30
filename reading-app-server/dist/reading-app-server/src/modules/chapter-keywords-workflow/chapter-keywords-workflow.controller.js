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
var ChapterKeywordsWorkflowController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterKeywordsWorkflowController = void 0;
const common_1 = require("@nestjs/common");
let ChapterKeywordsWorkflowController = class ChapterKeywordsWorkflowController {
    static { ChapterKeywordsWorkflowController_1 = this; }
    static disabledMessage = 'Chapter key sentence and key word generation moved to iOS local Foundation Models.';
    submitChapterKeywordsWorkflow() {
        throw this.featureDisabled();
    }
    getWorkflowStatus() {
        throw this.featureDisabled();
    }
    getWorkflowResult() {
        throw this.featureDisabled();
    }
    restartWorkflow() {
        throw this.featureDisabled();
    }
    getLatestChapterKeywords() {
        throw this.featureDisabled();
    }
    featureDisabled() {
        return new common_1.GoneException({
            status: 'error',
            error: {
                code: 'E.FEATURE_DISABLED',
                http: 410,
                message: ChapterKeywordsWorkflowController_1.disabledMessage,
            },
        });
    }
};
exports.ChapterKeywordsWorkflowController = ChapterKeywordsWorkflowController;
__decorate([
    (0, common_1.Post)('workflows/chapter-keywords'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "submitChapterKeywordsWorkflow", null);
__decorate([
    (0, common_1.Get)('workflows/chapter-keywords/:workflowRunId'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "getWorkflowStatus", null);
__decorate([
    (0, common_1.Get)('workflows/chapter-keywords/:workflowRunId/result'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "getWorkflowResult", null);
__decorate([
    (0, common_1.Post)('workflows/chapter-keywords/:workflowRunId/restart'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "restartWorkflow", null);
__decorate([
    (0, common_1.Get)('books/:bookId/chapters/:chapterId/chapter-keywords'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Object)
], ChapterKeywordsWorkflowController.prototype, "getLatestChapterKeywords", null);
exports.ChapterKeywordsWorkflowController = ChapterKeywordsWorkflowController = ChapterKeywordsWorkflowController_1 = __decorate([
    (0, common_1.Controller)('v1')
], ChapterKeywordsWorkflowController);
//# sourceMappingURL=chapter-keywords-workflow.controller.js.map