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
const message_service_1 = require("./message.service");
const abort_1 = require("../utils/abort");
let MessageController = class MessageController {
    messageService;
    constructor(messageService) {
        this.messageService = messageService;
    }
    createRequestAbortController(req, res) {
        const abortController = new AbortController();
        const abortRequest = () => {
            if (!abortController.signal.aborted) {
                abortController.abort((0, abort_1.createAbortError)('Client disconnected'));
            }
        };
        const abortOnClose = () => {
            if (!res.writableEnded) {
                abortRequest();
            }
        };
        req.once('aborted', abortRequest);
        res.once('close', abortOnClose);
        return {
            signal: abortController.signal,
            cleanup: () => {
                req.off('aborted', abortRequest);
                res.off('close', abortOnClose);
            },
        };
    }
    async handleMsg(rawBody, req, res) {
        const { signal, cleanup } = this.createRequestAbortController(req, res);
        try {
            const result = await this.messageService.handleMsg(rawBody ?? '', signal);
            if (result.stream) {
                let text = '';
                for await (const chunk of result.stream) {
                    text += chunk;
                }
                if (signal.aborted || res.destroyed)
                    return;
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
                if (signal.aborted || res.destroyed)
                    return;
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
        catch (error) {
            if ((0, abort_1.isAbortError)(error)) {
                return;
            }
            throw error;
        }
        finally {
            cleanup();
        }
    }
    async handleStream(rawBody, req, res) {
        const { signal, cleanup } = this.createRequestAbortController(req, res);
        try {
            const result = await this.messageService.handleStream(rawBody ?? '', signal);
            if ('status' in result && result.status === 'error') {
                if (signal.aborted || res.destroyed)
                    return;
                res.setHeader('Content-Type', 'application/json');
                res.status(result.error?.http ?? 500).send(JSON.stringify(result));
                return;
            }
            res.setHeader('Content-Type', 'application/json');
            res.status(200);
            if (result.stream) {
                for await (const chunk of result.stream) {
                    if (signal.aborted || res.destroyed)
                        return;
                    res.write(chunk);
                }
            }
            if (!res.writableEnded && !res.destroyed) {
                res.end();
            }
        }
        catch (error) {
            if ((0, abort_1.isAbortError)(error)) {
                return;
            }
            throw error;
        }
        finally {
            cleanup();
        }
    }
};
exports.MessageController = MessageController;
__decorate([
    (0, common_1.Post)('msg'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MessageController.prototype, "handleMsg", null);
__decorate([
    (0, common_1.Post)('stream'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], MessageController.prototype, "handleStream", null);
exports.MessageController = MessageController = __decorate([
    (0, common_1.Controller)(),
    __param(0, (0, common_1.Inject)(message_service_1.MessageService)),
    __metadata("design:paramtypes", [message_service_1.MessageService])
], MessageController);
//# sourceMappingURL=message.controller.js.map