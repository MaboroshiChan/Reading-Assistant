"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrap = exports.createApp = void 0;
require("reflect-metadata");
const express_1 = __importDefault(require("express"));
const core_1 = require("@nestjs/core");
const platform_express_1 = require("@nestjs/platform-express");
const app_module_1 = require("./app.module");
const runtime_config_1 = require("./config/runtime-config");
const createApp = async () => {
    const server = (0, express_1.default)();
    server.use(express_1.default.text({ type: '*/*', limit: '10mb' }));
    const app = await core_1.NestFactory.create(app_module_1.AppModule, new platform_express_1.ExpressAdapter(server), {
        bodyParser: false,
    });
    app.enableCors({
        origin: '*',
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'x-request-id',
            'Idempotency-Key',
            'X-App-Client',
        ],
        methods: ['GET', 'POST', 'OPTIONS'],
    });
    return app;
};
exports.createApp = createApp;
const bootstrap = async () => {
    const app = await (0, exports.createApp)();
    await app.listen(runtime_config_1.config.port);
    const mode = runtime_config_1.config.useMockLLM ? 'MOCK_LLM' : 'LIVE_LLM';
    console.log(`server on :${runtime_config_1.config.port} (${mode})`);
};
exports.bootstrap = bootstrap;
if (require.main === module) {
    void (0, exports.bootstrap)();
}
//# sourceMappingURL=main.js.map