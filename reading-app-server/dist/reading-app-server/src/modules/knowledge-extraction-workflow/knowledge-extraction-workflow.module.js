"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeExtractionWorkflowModule = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_module_1 = require("../book-ingestion/book-ingestion.module");
const knowledge_extraction_workflow_controller_1 = require("./knowledge-extraction-workflow.controller");
const knowledge_extraction_workflow_repository_1 = require("./knowledge-extraction-workflow.repository");
const knowledge_extraction_workflow_service_1 = require("./knowledge-extraction-workflow.service");
let KnowledgeExtractionWorkflowModule = class KnowledgeExtractionWorkflowModule {
};
exports.KnowledgeExtractionWorkflowModule = KnowledgeExtractionWorkflowModule;
exports.KnowledgeExtractionWorkflowModule = KnowledgeExtractionWorkflowModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => book_ingestion_module_1.BookIngestionModule)],
        controllers: [knowledge_extraction_workflow_controller_1.KnowledgeExtractionWorkflowController],
        providers: [knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository, knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService],
        exports: [knowledge_extraction_workflow_repository_1.KnowledgeExtractionWorkflowRepository, knowledge_extraction_workflow_service_1.KnowledgeExtractionWorkflowService],
    })
], KnowledgeExtractionWorkflowModule);
//# sourceMappingURL=knowledge-extraction-workflow.module.js.map