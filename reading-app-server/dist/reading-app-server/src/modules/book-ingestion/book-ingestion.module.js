"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BookIngestionModule = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_controller_1 = require("./book-ingestion.controller");
const book_ingestion_repository_1 = require("./book-ingestion.repository");
const book_ingestion_service_1 = require("./book-ingestion.service");
let BookIngestionModule = exports.BookIngestionModule = class BookIngestionModule {
};
exports.BookIngestionModule = BookIngestionModule = __decorate([
    (0, common_1.Module)({
        controllers: [book_ingestion_controller_1.BookIngestionController],
        providers: [book_ingestion_repository_1.BookIngestionRepository, book_ingestion_service_1.BookIngestionService],
        exports: [book_ingestion_repository_1.BookIngestionRepository, book_ingestion_service_1.BookIngestionService],
    })
], BookIngestionModule);
//# sourceMappingURL=book-ingestion.module.js.map