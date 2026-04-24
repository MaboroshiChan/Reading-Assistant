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
exports.MessageController = void 0;
const common_1 = require("@nestjs/common");
const llmService_1 = require("../../services/llmService");
const message_http_service_1 = require("./message-http.service");
let MessageController = class MessageController {
    messageHttpService;
    constructor(messageHttpService) {
        this.messageHttpService = messageHttpService;
    }
    async handleMsg(rawBody, res) {
        const result = await this.messageHttpService.handleMsg(rawBody ?? '');
        if (result.stream) {
            let text = '';
            for await (const chunk of result.stream) {
                text += chunk;
            }
            let parsed;
            try {
                parsed = (0, llmService_1.extractJsonFromText)(text);
            }
            catch (error) {
                console.error('Failed to parse stream output', error);
                parsed = { _raw_error: text };
            }
            if (parsed && typeof parsed === 'object' && 'status' in parsed && 'request_id' in parsed) {
                res.setHeader('Content-Type', 'application/json');
                res.status(200).send(JSON.stringify(parsed));
                return;
            }
            const usage = await result.usage;
            const buffered = {
                ...result,
                stream: undefined,
                served_from: 'fresh',
                data: parsed,
                usage,
            };
            res.setHeader('Content-Type', 'application/json');
            res.status(200).send(JSON.stringify(buffered));
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        const statusCode = result.status === 'error'
            ? result.error?.http ?? 500
            : 200;
        res.status(statusCode).send(JSON.stringify(result));
    }
    async handleStream(rawBody, res) {
        const result = await this.messageHttpService.handleStream(rawBody ?? '');
        if ('status' in result && result.status === 'error') {
            res.setHeader('Content-Type', 'application/json');
            res.status(result.error?.http ?? 500).send(JSON.stringify(result));
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.status(200);
        if (result.stream) {
            for await (const chunk of result.stream) {
                res.write(chunk);
            }
        }
        res.end();
    }
};
exports.MessageController = MessageController;
__decorate([
    (0, common_1.Post)('msg'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessageController.prototype, "handleMsg", null);
__decorate([
    (0, common_1.Post)('stream'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MessageController.prototype, "handleStream", null);
exports.MessageController = MessageController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(message_http_service_1.MessageHttpService)),
    __metadata("design:paramtypes", [message_http_service_1.MessageHttpService])
], MessageController);
//# sourceMappingURL=message.controller.js.map