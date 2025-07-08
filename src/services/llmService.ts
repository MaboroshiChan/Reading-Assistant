import { OpenAI } from "openai/client.js";
import * as fs from "fs/promises";
import * as path from "path";

// 初始化 OpenAI 客户端
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// 使用 prompt 生成文本
export async function generateText(prompt: string): Promise<string | null> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
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

// 读取 prompt.txt 并调用 LLM
export async function llmService(): Promise<string | null> {
    try {
        const promptPath = path.resolve(__dirname, "../../prompts/system-prompt.txt");
        const prompt = await fs.readFile(promptPath, "utf-8");

        const result = await generateText(prompt);
        return result;
    } catch (error) {
        console.error("Error in llmService:", error);
        throw error;
    }
}