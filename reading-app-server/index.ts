import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { generateLLMAnalysis } from "./services/llmService";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.post("/generate-llm-analysis", async (req, res) => {
  const { paragraph } = req.body;
  if (!paragraph || typeof paragraph !== "string") {
    return res.status(400).json({ error: "Missing or invalid paragraph" });
  }

  try {
    const result = await generateLLMAnalysis(paragraph); // This uses OpenAI and process.env
    res.json({ analysis: result });
  } catch (err) {
    console.error("LLM error:", err);
    res.status(500).json({ error: "LLM analysis failed" });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});