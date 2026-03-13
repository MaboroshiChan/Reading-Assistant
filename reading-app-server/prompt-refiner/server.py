from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json
import os
from typing import List

# Import our Gemini configuration and models from dspy logic
import dspy
from dspy_logic import gemini, KeywordExtraction, optimize_prompt

app = FastAPI(title="Prompt Refiner")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATASET_PATH = os.path.join(os.path.dirname(__file__), "golden_dataset.json")

class GenerateRequest(BaseModel):
    sentence: str

class GenerateResponse(BaseModel):
    candidates: List[str]

class SaveRequest(BaseModel):
    sentence: str
    key_words: str

@app.get("/sentences")
def get_sentences():
    # Provide a list of unannotated sentences
    return {
        "sentences": [
            "However, if it rains tomorrow, we will not be able to run fast in the park.",
            "He usually doesn't like to swim, because the water is too cold.",
            "They should have known that the mission was compromised.",
            "The quick brown fox jumps over the lazy dog.",
            "Furthermore, although she was exhausted, she decided to keep working on the project."
        ]
    }

@app.post("/generate", response_model=GenerateResponse)
def generate_candidates(req: GenerateRequest):
    text = req.sentence
    styles = ["Strict predicate focus", "Comprehensive connectors and modifiers", "Balanced extraction"]
    candidates = []
    
    for s in styles:
        prompt = (
            f"Extract the key words from this sentence using a '{s}' approach. "
            f"Follow these rules strictly: include predicates, subclause markers, connectors, negations, "
            f"infinitives, sentence adverbs, and modal verbs. DO NOT include nouns. Keep it short (1-3 words). "
            f"Output ONLY comma-separated keywords. "
            f"Sentence: {text}"
        )
        res = gemini(prompt)
        candidates.append(res[0] if isinstance(res, list) else res)

    return {"candidates": candidates}

@app.post("/save")
def save_feedback(req: SaveRequest):
    # Load existing
    golden_examples = []
    if os.path.exists(DATASET_PATH):
        with open(DATASET_PATH, 'r', encoding='utf-8') as f:
            try:
                data = json.load(f)
                golden_examples = data
            except json.JSONDecodeError:
                pass
                
    # Append the new instance. Keep the same format as dspy_logic.py
    new_ex = {"sentence": req.sentence, "key_words": req.key_words}
    golden_examples.append(new_ex)
    
    with open(DATASET_PATH, 'w', encoding='utf-8') as f:
        json.dump(golden_examples, f, ensure_ascii=False, indent=2)
        
    return {"status": "success", "total_examples": len(golden_examples)}

@app.post("/optimize")
def trigger_optimization():
    # Call the optimization logic from dspy_logic.py
    result = optimize_prompt()
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
