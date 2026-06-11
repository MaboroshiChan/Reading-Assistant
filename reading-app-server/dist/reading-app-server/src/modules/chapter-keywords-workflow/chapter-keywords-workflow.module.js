"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterKeywordsWorkflowModule = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_module_1 = require("../book-ingestion/book-ingestion.module");
const workflow_queue_module_1 = require("../workflow-queue/workflow-queue.module");
const chapter_keywords_workflow_controller_1 = require("./chapter-keywords-workflow.controller");
const chapter_keywords_workflow_repository_1 = require("./chapter-keywords-workflow.repository");
const chapter_keywords_workflow_service_1 = require("./chapter-keywords-workflow.service");
let ChapterKeywordsWorkflowModule = class ChapterKeywordsWorkflowModule {
};
exports.ChapterKeywordsWorkflowModule = ChapterKeywordsWorkflowModule;
exports.ChapterKeywordsWorkflowModule = ChapterKeywordsWorkflowModule = __decorate([
    (0, common_1.Module)({
        imports: [book_ingestion_module_1.BookIngestionModule, workflow_queue_module_1.WorkflowQueueModule],
        controllers: [chapter_keywords_workflow_controller_1.ChapterKeywordsWorkflowController],
        providers: [chapter_keywords_workflow_repository_1.ChapterKeywordsWorkflowRepository, chapter_keywords_workflow_service_1.ChapterKeywordsWorkflowService],
        exports: [chapter_keywords_workflow_repository_1.ChapterKeywordsWorkflowRepository, chapter_keywords_workflow_service_1.ChapterKeywordsWorkflowService],
    })
], ChapterKeywordsWorkflowModule);
//# sourceMappingURL=chapter-keywords-workflow.module.js.map