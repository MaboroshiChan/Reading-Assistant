"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterOpenAnalysisModule = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_module_1 = require("../book-ingestion/book-ingestion.module");
const chapter_keywords_workflow_module_1 = require("../chapter-keywords-workflow/chapter-keywords-workflow.module");
const knowledge_extraction_workflow_module_1 = require("../knowledge-extraction-workflow/knowledge-extraction-workflow.module");
const quiz_workflow_module_1 = require("../quiz-workflow/quiz-workflow.module");
const workflow_queue_module_1 = require("../workflow-queue/workflow-queue.module");
const pre_reading_workflow_module_1 = require("../pre-reading-workflow/pre-reading-workflow.module");
const chapter_open_analysis_controller_1 = require("./chapter-open-analysis.controller");
const chapter_open_analysis_repository_1 = require("./chapter-open-analysis.repository");
const chapter_open_analysis_service_1 = require("./chapter-open-analysis.service");
let ChapterOpenAnalysisModule = class ChapterOpenAnalysisModule {
};
exports.ChapterOpenAnalysisModule = ChapterOpenAnalysisModule;
exports.ChapterOpenAnalysisModule = ChapterOpenAnalysisModule = __decorate([
    (0, common_1.Module)({
        imports: [
            book_ingestion_module_1.BookIngestionModule,
            workflow_queue_module_1.WorkflowQueueModule,
            pre_reading_workflow_module_1.PreReadingWorkflowModule,
            chapter_keywords_workflow_module_1.ChapterKeywordsWorkflowModule,
            knowledge_extraction_workflow_module_1.KnowledgeExtractionWorkflowModule,
            quiz_workflow_module_1.QuizWorkflowModule,
        ],
        controllers: [chapter_open_analysis_controller_1.ChapterOpenAnalysisController],
        providers: [chapter_open_analysis_repository_1.ChapterOpenAnalysisRepository, chapter_open_analysis_service_1.ChapterOpenAnalysisService],
        exports: [chapter_open_analysis_repository_1.ChapterOpenAnalysisRepository, chapter_open_analysis_service_1.ChapterOpenAnalysisService],
    })
], ChapterOpenAnalysisModule);
//# sourceMappingURL=chapter-open-analysis.module.js.map