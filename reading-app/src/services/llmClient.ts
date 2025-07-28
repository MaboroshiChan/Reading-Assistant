import type { Paragraph } from "../analysis/structure/Paragraph";

export async function fetchLLMAnalysis(paragraph: string): Promise<Paragraph> {
    try {
        const res = await fetch("http://localhost:3001/generate-llm-analysis", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ paragraph })
        });

        const json: Paragraph = await res.json();
        return json;
    } catch (err) {
        console.error("Frontend fetchLLMAnalysis error:", err);
        throw err;
    }
}