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
exports.KnowledgeExtractionWorkflowController = void 0;
const common_1 = require("@nestjs/common");
const knowledge_extraction_workflow_service_1 = require("./knowledge-extraction-workflow.service");
let KnowledgeExtractionWorkflowController = class KnowledgeExtractionWorkflowController {
    knowledgeExtractionWorkflowService;
    constructor(knowledgeExtractionWorkflowService) {
        this.knowledgeExtractionWorkflowService = knowledgeExtractionWorkflowService;
    }
    submitKnowledgeExtractionWorkflow(rawBody) {
        const request = this.knowledgeExtractionWorkflowService.parseSubmitRequest(rawBody);
        return this.knowledgeExtractionWorkflowService.submitKnowledgeExtractionWorkflow(request);
    }
    getWorkflowStatus(workflowRunId) {
        return this.knowledgeExtractionWorkflowService.getWorkflowStatus(workflowRunId);
    }
    getWorkflowResult(workflowRunId) {
        return this.knowledgeExtractionWorkflowService.getWorkflowResult(workflowRunId);
    }
    getLatestChapterKnowledgeExtraction(bookId, chapterId) {
        return this.knowledgeExtractionWorkflowService.getLatestChapterKnowledgeExtraction(bookId, chapterId);
    }
};
exports.KnowledgeExtractionWorkflowController = KnowledgeExtractionWorkflowController;
__decorate([
    (0, common_1.Post)('workflows/knowledge-extraction'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], KnowledgeExtractionWorkflowController.prototype, "submitKnowledgeExtractionWorkflow", null);
__decorate([
    (0, common_1.Get)('workflows/knowledge-extraction/:workflowRunId'),
    __param(0, (0, common_1.Param)('workflowRunId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], KnowledgeExtractionWorkflowController.prototype, "getWorkflowStatus", null);
__decorate([
    (0, common_1.Get)('workflows/knowledge-extraction/:workflowRunId/result'),
    __param(0, (0, common_1.Param)('workflowRunId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], KnowledgeExtractionWorkflowController.prototype, "getWorkflowResult", null);
__decorate([
    (0, common_1.Get)('books/:bookId/chapters/:chapterId/knowledge-extraction'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Object)
], KnowledgeExtractionWorkflowController.prototype, "getLatestChapterKnowledgeExtraction", null);
exports.KnowledgeExtractionWorkflowController = KnowledgeExtractionWorkflowController = __decorate([
    (0, common_1.Controller)('v1'),
    __param(0, (0, common_1.Inject)(knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService)),
    __metadata("design:paramtypes", [knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService])
], KnowledgeExtractionWorkflowController);
//# sourceMappingURL=knowledge-extraction-workflow.controller.js.map