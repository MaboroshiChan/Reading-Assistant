import { OpenAI } from "openai/client.js";
import * as fs from "fs/promises";
import * as path from "path";
import type { Paragraph } from "../../reading-app/src/analysis/structure/Paragraph";

// 初始化 OpenAI 客户端
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

