import type { LLMAnalysis } from "../analysis/structure/Sentence";

export async function fetchLLMAnalysis(paragraph: string): Promise<LLMAnalysis[]> {
  try {
    const res = await fetch("http://localhost:3001/generate-llm-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paragraph })
    });

    const json = await res.json();
    return json.analysis ?? [];
  } catch (err) {
    console.error("Frontend fetchLLMAnalysis error:", err);
    return [];
  }
}