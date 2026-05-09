"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SurrealService = void 0;
const common_1 = require("@nestjs/common");
const runtime_config_1 = require("../../config/runtime-config");
const trimTrailingSlash = (value) => value.replace(/\/+$/, '');
const stripSurrealMetadata = (record) => {
    const sanitized = { ...record };
    delete sanitized.id;
    return sanitized;
};
let SurrealService = class SurrealService {
    endpoint = '';
    async onModuleInit() {
        const missing = [
            ['SURREAL_URL', runtime_config_1.config.surrealUrl],
            ['SURREAL_NS', runtime_config_1.config.surrealNamespace],
            ['SURREAL_DB', runtime_config_1.config.surrealDatabase],
            ['SURREAL_USER', runtime_config_1.config.surrealUser],
            ['SURREAL_PASS', runtime_config_1.config.surrealPass],
        ].filter(([, value]) => value.trim() === '');
        if (missing.length > 0) {
            throw new Error(`Missing SurrealDB configuration: ${missing.map(([key]) => key).join(', ')}`);
        }
        this.endpoint = trimTrailingSlash(runtime_config_1.config.surrealUrl);
        await this.healthcheck();
    }
    async query(sql) {
        this.ensureConfigured();
        const response = await fetch(`${this.endpoint}/sql`, {
            method: 'POST',
            headers: {
                ...this.createHeaders(),
                'Content-Type': 'text/plain',
            },
            body: sql,
        });
        const payload = await this.parseJson(response);
        if (!response.ok) {
            throw new Error(`SurrealDB query failed with HTTP ${response.status}`);
        }
        for (const statement of payload) {
            if (statement.status !== 'OK') {
                const detail = typeof statement.detail === 'string' && statement.detail.trim().length > 0
                    ? statement.detail
                    : undefined;
                const result = typeof statement.result === 'string' && statement.result.trim().length > 0
                    ? statement.result
                    : undefined;
                const kind = statement.kind ? `[${statement.kind}] ` : '';
                throw new Error(`${kind}${detail ?? result ?? 'SurrealDB query returned a non-OK statement status'}`);
            }
        }
        return payload.map((statement) => statement.result);
    }
    async selectTable(table) {
        const [result = []] = await this.query(`SELECT * FROM ${table};`);
        return result;
    }
    async selectRecord(table, id) {
        const [result = []] = await this.query(`SELECT * FROM ${table}:${id};`);
        return result[0] ?? null;
    }
    async putRecord(table, id, record) {
        this.ensureConfigured();
        const sanitizedRecord = stripSurrealMetadata(record);
        const response = await fetch(`${this.endpoint}/key/${table}/${id}`, {
            method: 'PUT',
            headers: {
                ...this.createHeaders(),
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(sanitizedRecord),
        });
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            throw new Error(`SurrealDB write failed with HTTP ${response.status}${body ? `: ${body}` : ''}`);
        }
    }
    async putRelationRecord(table, id, inRef, outRef, record) {
        const relationContent = { ...stripSurrealMetadata(record) };
        delete relationContent.in;
        delete relationContent.out;
        const content = JSON.stringify(relationContent);
        await this.query([
            `DELETE ONLY ${table}:${id};`,
            `RELATE ${inRef}->${table}:${id}->${outRef} CONTENT ${content};`,
        ].join('\n'));
    }
    async healthcheck() {
        const response = await fetch(`${this.endpoint}/health`, {
            method: 'GET',
            headers: {
                Accept: 'application/json',
            },
        });
        if (!response.ok) {
            throw new Error(`SurrealDB healthcheck failed with HTTP ${response.status}`);
        }
    }
    createHeaders() {
        return {
            Accept: 'application/json',
            Authorization: `Basic ${Buffer.from(`${runtime_config_1.config.surrealUser}:${runtime_config_1.config.surrealPass}`, 'utf8').toString('base64')}`,
            'Surreal-NS': runtime_config_1.config.surrealNamespace,
            'Surreal-DB': runtime_config_1.config.surrealDatabase,
        };
    }
    ensureConfigured() {
        if (this.endpoint.trim() === '') {
            throw new Error('SurrealDB client is not initialized');
        }
    }
    async parseJson(response) {
        try {
            return await response.json();
        }
        catch (error) {
            throw new Error(`Failed to parse SurrealDB response JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
};
exports.SurrealService = SurrealService;
exports.SurrealService = SurrealService = __decorate([
    (0, common_1.Injectable)()
], SurrealService);
//# sourceMappingURL=surrealdb.service.js.map