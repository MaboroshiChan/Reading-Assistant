import { OpenAI } from "openai/client.js";

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function generateText(prompt: string): Promise<string | null> {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
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