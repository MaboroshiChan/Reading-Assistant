"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PreReadingWorkflowModule = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_module_1 = require("../book-ingestion/book-ingestion.module");
const workflow_queue_module_1 = require("../workflow-queue/workflow-queue.module");
const pre_reading_workflow_controller_1 = require("./pre-reading-workflow.controller");
const pre_reading_workflow_repository_1 = require("./pre-reading-workflow.repository");
const pre_reading_workflow_service_1 = require("./pre-reading-workflow.service");
let PreReadingWorkflowModule = class PreReadingWorkflowModule {
};
exports.PreReadingWorkflowModule = PreReadingWorkflowModule;
exports.PreReadingWorkflowModule = PreReadingWorkflowModule = __decorate([
    (0, common_1.Module)({
        imports: [(0, common_1.forwardRef)(() => book_ingestion_module_1.BookIngestionModule), workflow_queue_module_1.WorkflowQueueModule],
        controllers: [pre_reading_workflow_controller_1.PreReadingWorkflowController],
        providers: [pre_reading_workflow_repository_1.PreReadingWorkflowRepository, pre_reading_workflow_service_1.PreReadingWorkflowService],
        exports: [pre_reading_workflow_repository_1.PreReadingWorkflowRepository, pre_reading_workflow_service_1.PreReadingWorkflowService],
    })
], PreReadingWorkflowModule);
//# sourceMappingURL=pre-reading-workflow.module.js.map