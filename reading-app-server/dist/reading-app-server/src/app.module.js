"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const health_controller_1 = require("./health.controller");
const runtime_config_1 = require("./config/runtime-config");
const message_controller_1 = require("./message/message.controller");
const message_http_service_1 = require("./message/message-http.service");
const book_ingestion_module_1 = require("./modules/book-ingestion/book-ingestion.module");
const knowledge_extraction_workflow_module_1 = require("./modules/knowledge-extraction-workflow/knowledge-extraction-workflow.module");
const quiz_workflow_module_1 = require("./modules/quiz-workflow/quiz-workflow.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                ignoreEnvFile: true,
                load: [runtime_config_1.appConfig],
            }),
            book_ingestion_module_1.BookIngestionModule,
            knowledge_extraction_workflow_module_1.KnowledgeExtractionWorkflowModule,
            quiz_workflow_module_1.QuizWorkflowModule,
        ],
        controllers: [health_controller_1.HealthController, message_controller_1.MessageController],
        providers: [message_http_service_1.MessageHttpService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map