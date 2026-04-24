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
exports.BookIngestionController = void 0;
const common_1 = require("@nestjs/common");
const book_ingestion_service_1 = require("./book-ingestion.service");
let BookIngestionController = class BookIngestionController {
    bookIngestionService;
    constructor(bookIngestionService) {
        this.bookIngestionService = bookIngestionService;
    }
    upsertPageFragment(bookId, chapterId, rawPageIndex, rawBody) {
        const params = {
            bookId,
            chapterId,
            pageIndex: this.bookIngestionService.parsePageIndex(rawPageIndex),
        };
        const request = this.bookIngestionService.parseUpsertRequest(rawBody, params);
        return this.bookIngestionService.upsertPageFragment(request);
    }
    getChapter(bookId, chapterId) {
        return this.bookIngestionService.getChapter(bookId, chapterId);
    }
    getPage(bookId, chapterId, rawPageIndex) {
        return this.bookIngestionService.getPage(bookId, chapterId, this.bookIngestionService.parsePageIndex(rawPageIndex));
    }
};
exports.BookIngestionController = BookIngestionController;
__decorate([
    (0, common_1.Post)(':bookId/chapters/:chapterId/pages/:pageIndex'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __param(2, (0, common_1.Param)('pageIndex')),
    __param(3, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, Object]),
    __metadata("design:returntype", Object)
], BookIngestionController.prototype, "upsertPageFragment", null);
__decorate([
    (0, common_1.Get)(':bookId/chapters/:chapterId'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Object)
], BookIngestionController.prototype, "getChapter", null);
__decorate([
    (0, common_1.Get)(':bookId/chapters/:chapterId/pages/:pageIndex'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __param(2, (0, common_1.Param)('pageIndex')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Object)
], BookIngestionController.prototype, "getPage", null);
exports.BookIngestionController = BookIngestionController = __decorate([
    (0, common_1.Controller)('v1/books'),
    __param(0, (0, common_1.Inject)(book_ingestion_service_1.BookIngestionService)),
    __metadata("design:paramtypes", [book_ingestion_service_1.BookIngestionService])
], BookIngestionController);
//# sourceMappingURL=book-ingestion.controller.js.map