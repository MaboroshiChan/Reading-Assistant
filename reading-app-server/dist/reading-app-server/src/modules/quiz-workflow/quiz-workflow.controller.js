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
exports.QuizWorkflowController = void 0;
const common_1 = require("@nestjs/common");
const quiz_workflow_service_1 = require("./quiz-workflow.service");
let QuizWorkflowController = class QuizWorkflowController {
    quizWorkflowService;
    constructor(quizWorkflowService) {
        this.quizWorkflowService = quizWorkflowService;
    }
    submitQuizWorkflow(rawBody) {
        const request = this.quizWorkflowService.parseSubmitRequest(rawBody);
        return this.quizWorkflowService.submitQuizWorkflow(request);
    }
    getWorkflowStatus(workflowRunId) {
        return this.quizWorkflowService.getWorkflowStatus(workflowRunId);
    }
    getWorkflowResult(workflowRunId) {
        return this.quizWorkflowService.getWorkflowResult(workflowRunId);
    }
    getLatestChapterQuiz(bookId, chapterId) {
        return this.quizWorkflowService.getLatestChapterQuiz(bookId, chapterId);
    }
};
exports.QuizWorkflowController = QuizWorkflowController;
__decorate([
    (0, common_1.Post)('workflows/quiz'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Object)
], QuizWorkflowController.prototype, "submitQuizWorkflow", null);
__decorate([
    (0, common_1.Get)('workflows/quiz/:workflowRunId'),
    __param(0, (0, common_1.Param)('workflowRunId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], QuizWorkflowController.prototype, "getWorkflowStatus", null);
__decorate([
    (0, common_1.Get)('workflows/quiz/:workflowRunId/result'),
    __param(0, (0, common_1.Param)('workflowRunId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Object)
], QuizWorkflowController.prototype, "getWorkflowResult", null);
__decorate([
    (0, common_1.Get)('books/:bookId/chapters/:chapterId/quiz'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Object)
], QuizWorkflowController.prototype, "getLatestChapterQuiz", null);
exports.QuizWorkflowController = QuizWorkflowController = __decorate([
    (0, common_1.Controller)('v1'),
    __param(0, (0, common_1.Inject)(quiz_workflow_service_1.QuizWorkflowService)),
    __metadata("design:paramtypes", [quiz_workflow_service_1.QuizWorkflowService])
], QuizWorkflowController);
//# sourceMappingURL=quiz-workflow.controller.js.map