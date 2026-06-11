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
exports.ChapterOpenAnalysisController = void 0;
const common_1 = require("@nestjs/common");
const chapter_open_analysis_service_1 = require("./chapter-open-analysis.service");
let ChapterOpenAnalysisController = class ChapterOpenAnalysisController {
    chapterOpenAnalysisService;
    constructor(chapterOpenAnalysisService) {
        this.chapterOpenAnalysisService = chapterOpenAnalysisService;
    }
    submitChapterOpenAnalysis(bookId, chapterId, rawBody) {
        const request = this.chapterOpenAnalysisService.parseSubmitRequest(bookId, chapterId, rawBody);
        return this.chapterOpenAnalysisService.submitChapterOpenAnalysis(request);
    }
    getChapterOpenAnalysisStatus(bookId, chapterId) {
        return this.chapterOpenAnalysisService.getChapterOpenAnalysisStatus(bookId, chapterId);
    }
    getChapterOpenAnalysisResult(bookId, chapterId) {
        return this.chapterOpenAnalysisService.getChapterOpenAnalysisResult(bookId, chapterId);
    }
};
exports.ChapterOpenAnalysisController = ChapterOpenAnalysisController;
__decorate([
    (0, common_1.Post)('books/:bookId/chapters/:chapterId/open-analysis'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Object)
], ChapterOpenAnalysisController.prototype, "submitChapterOpenAnalysis", null);
__decorate([
    (0, common_1.Get)('books/:bookId/chapters/:chapterId/open-analysis'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Object)
], ChapterOpenAnalysisController.prototype, "getChapterOpenAnalysisStatus", null);
__decorate([
    (0, common_1.Get)('books/:bookId/chapters/:chapterId/open-analysis/result'),
    __param(0, (0, common_1.Param)('bookId')),
    __param(1, (0, common_1.Param)('chapterId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", Object)
], ChapterOpenAnalysisController.prototype, "getChapterOpenAnalysisResult", null);
exports.ChapterOpenAnalysisController = ChapterOpenAnalysisController = __decorate([
    (0, common_1.Controller)('v1'),
    __param(0, (0, common_1.Inject)(chapter_open_analysis_service_1.ChapterOpenAnalysisService)),
    __metadata("design:paramtypes", [chapter_open_analysis_service_1.ChapterOpenAnalysisService])
], ChapterOpenAnalysisController);
//# sourceMappingURL=chapter-open-analysis.controller.js.map