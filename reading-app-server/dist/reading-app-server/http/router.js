"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStream = exports.handleMsg = exports.dispatch = void 0;
var message_service_1 = require("../src/message/message.service");
Object.defineProperty(exports, "dispatch", { enumerable: true, get: function () { return message_service_1.dispatchEnvelope; } });
Object.defineProperty(exports, "handleMsg", { enumerable: true, get: function () { return message_service_1.handleRawMessage; } });
Object.defineProperty(exports, "handleStream", { enumerable: true, get: function () { return message_service_1.handleRawStream; } });
//# sourceMappingURL=router.js.map