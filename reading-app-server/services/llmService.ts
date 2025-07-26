import { OpenAI } from "openai/client.js";
import * as fs from "fs/promises";
import * as path from "path";
import type { LLMAnalysis } from "../../reading-app/src/analysis/structure/Sentence"; // Adjust the import path as needed

// 初始化 OpenAI 客户端
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// 使用 prompt 生成文本
/**
 * 
 * import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const response = await openai.responses.create({
  prompt: {
    "id": "pmpt_68846fbc0c208195857fdf65a81fd44b0af0fe47efc88e14",
    "version": "2"
  }
});
 */
export async function generateText(prompt: string, paragraph: string): Promise<string | null> {
    try {
        console.log("Now connecting to OpenAI API with prompt:", prompt);
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: prompt
                },
                {
                    role: "user",
                    content: paragraph
                }
            ],
        });

        if (response.choices && response.choices.length > 0) {
            return response.choices[0].message.content;
        } else {
            throw new Error("No choices returned from OpenAI API");
        }
    } catch (error) {
        console.error("Error generating text:", error);
        throw error;
    }
}

// 读取 prompt.txt ../../prompts/system-prompt.txt
async function readPromptFile(): Promise<string> {
    try {
        const filePath = path.join(__dirname, "../prompts/system-prompt.txt");
        const data = await fs.readFile(filePath, "utf-8");
        return data;
    } catch (error) {
        console.error("Error reading prompt file:", error);
        throw error;
    }
}

function extractJSONFromCodeBlock(raw: string): any {
    // Remove ```json or ``` at the beginning, and ending ```
    const cleaned = raw
        .replace(/^```json\s*/i, "") // remove ```json
        .replace(/^```\s*/i, "")     // or plain ```
        .replace(/```$/, "")         // remove ending ```
        .trim();

    return JSON.parse(cleaned);
}

// 生成 LLM 分析结果
export function generateLLMAnalysis(text: string): Promise<LLMAnalysis[]> {
    return readPromptFile()
        .then(prompt => {
            return generateText(prompt, text);
        })
        .then(response => {
            if (!response) return [];

            try {
                const parsed = extractJSONFromCodeBlock(response);
                console.log("Parsed JSON:", parsed);

                if (Array.isArray(parsed.sentences)) {
                    return parsed.sentences as LLMAnalysis[];
                } else {
                    throw new Error("Parsed response does not contain 'sentences' array");
                }
            } catch (e) {
                console.error("Failed to parse JSON:", e);
                return [];
            }
        })
        .catch(error => {
            console.error("Error generating LLM analysis:", error);
            return [];
        });
}
