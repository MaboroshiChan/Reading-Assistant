import dspy
import os
import json
from dspy.teleprompt import BootstrapFewShot

# ======================================================
# 1. Configuration: Gemini 2.5 Flash
# ======================================================
# Ensure you have set your API key in your environment variables
if "GEMINI_API_KEY" not in os.environ:
    os.environ["GEMINI_API_KEY"] = "YOUR_GEMINI_API_KEY" 

# Use gemini-2.5-flash for speed and cost-efficiency during iteration
gemini = dspy.LM(model='gemini/gemini-2.5-flash', api_key=os.environ["GEMINI_API_KEY"])
dspy.settings.configure(lm=gemini)

# ======================================================
# 2. Define the Task (Signature)
# ======================================================
# Load instructions from Text file
prompt_path = os.path.join(os.path.dirname(__file__), "Initial_prompt.txt")
try:
    with open(prompt_path, "r", encoding="utf-8") as f:
        INSTRUCTIONS = f.read().strip()
except FileNotFoundError:
    INSTRUCTIONS = "Extract the most semantically significant text pieces (key words) from a sentence."

class KeywordExtraction(dspy.Signature):
    __doc__ = INSTRUCTIONS
    sentence = dspy.InputField(desc="A single sentence to be analyzed")
    key_words = dspy.OutputField(desc="Comma-separated list of extracted key words, adhering precisely to the guidelines")

# Define the base module with Chain of Thought
extractor = dspy.ChainOfThought(KeywordExtraction)

# ======================================================
# 3. Human Feedback Collection Logic
# ======================================================
def collect_human_feedback(raw_sentences, save_path=None):
    if save_path is None:
        save_path = os.path.join(os.path.dirname(__file__), "golden_dataset.json")
        
    golden_examples = []
    
    # Load existing progress if available
    if os.path.exists(save_path):
        with open(save_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
            golden_examples = [dspy.Example(**item).with_inputs('sentence') for item in data]
            print(f"Loaded {len(golden_examples)} existing examples from local storage.")

    for text in raw_sentences:
        print("\n" + "="*60)
        print(f"【ORIGINAL SENTENCE】: {text}")
        
        # Generate 3 candidates with different "hidden" prompts
        styles = ["Strict predicate focus", "Comprehensive connectors and modifiers", "Balanced extraction"]
        candidates = []
        
        for s in styles:
            # We use a direct call to simulate different prompt variations using the Initial_prompt.txt as a base
            prompt = (
                f"{INSTRUCTIONS}\n\n"
                f"Extract the key words from this sentence using a '{s}' approach. "
                f"Keep it short (1-3 words). Output ONLY comma-separated keywords.\n"
                f"Sentence: {text}"
            )
            res = gemini(prompt)
            candidates.append(res[0] if isinstance(res, list) else res)

        for i, cand in enumerate(candidates):
            print(f"\n--- [Option {i}] Style: {styles[i]} ---")
            print(cand)

        # Human interaction
        choice = input("\nWhich one do you prefer? (Enter 0/1/2 to accept, 'n' to skip, or type your own manually): ")
        
        if choice.isdigit() and int(choice) in [0, 1, 2]:
            best_keywords = candidates[int(choice)]
            new_ex = dspy.Example(sentence=text, key_words=best_keywords).with_inputs('sentence')
            golden_examples.append(new_ex)
            
            # Save to local JSON in real-time
            serializable = [ex.toDict() for ex in golden_examples]
            with open(save_path, 'w', encoding='utf-8') as f:
                json.dump(serializable, f, ensure_ascii=False, indent=2)
            print(">>> Saved to Golden Dataset.")
        elif choice.lower() != 'n' and choice.strip() != "":
            # Treat string input as manual override
            new_ex = dspy.Example(sentence=text, key_words=choice.strip()).with_inputs('sentence')
            golden_examples.append(new_ex)
            
            serializable = [ex.toDict() for ex in golden_examples]
            with open(save_path, 'w', encoding='utf-8') as f:
                json.dump(serializable, f, ensure_ascii=False, indent=2)
            print(">>> Saved manual edit to Golden Dataset.")
        else:
            print(">>> Skipped.")
            
    return golden_examples

# ======================================================
# 4. Execution Pipeline
# ======================================================

if __name__ == "__main__":
    # Sample data for your Reading App
    sample_texts = [
        "However, if it rains tomorrow, we will not be able to run fast in the park.",
        "He usually doesn't like to swim, because the water is too cold.",
        "They should have known that the mission was compromised."
    ]

    # Step A: Human Selection Mode
    print("Starting Human Annotation Mode...")
    my_trainset = collect_human_feedback(sample_texts)

def optimize_prompt():
    """
    Triggers the DSPy BootstrapFewShot optimizer using the golden_dataset.json.
    """
    save_path = os.path.join(os.path.dirname(__file__), "golden_dataset.json")
    
    if not os.path.exists(save_path):
        return {"status": "error", "message": "No golden_dataset.json found. Please annotate some sentences first."}

    with open(save_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        my_trainset = [dspy.Example(**item).with_inputs('sentence') for item in data]

    if len(my_trainset) == 0:
        return {"status": "error", "message": "Dataset is empty."}

    print(f"\n>>> Optimizing Prompt based on {len(my_trainset)} examples...")

    def simple_metric(example, pred, trace=None):
        return len(pred.key_words.strip()) > 0

    # Compile the prompt
    optimizer = BootstrapFewShot(metric=simple_metric)
    compiled_app = optimizer.compile(extractor, trainset=my_trainset)

    # Save the result
    model_save_path = os.path.join(os.path.dirname(__file__), "optimized_reading_agent.json")
    compiled_app.save(model_save_path)
    
    # Generate the text representation of the prompt
    txt_save_path = os.path.join(os.path.dirname(__file__), "Optimized_prompt.txt")
    
    try:
        # Build a human-readable representation of the finished prompt
        prompt_text = f"[INSTRUCTIONS]\n{INSTRUCTIONS}\n\n[FEW-SHOT EXAMPLES (Learned from UI)]\n"
        
        # Extract the examples that DSPy actually selected to use
        # compiled_app.demos contains the few-shot traces it bootstrapped
        demos_to_print = []
        if hasattr(compiled_app, 'demos') and compiled_app.demos:
            demos_to_print = compiled_app.demos
        else:
            # Fallback: If DSPy couldn't bootstrap traces (e.g., due to metric failures), it still uses the dataset directly
            demos_to_print = my_trainset
            prompt_text += "(Note: These are the raw examples loaded from the UI. DSPy trace generation was skipped.)\n"

        if demos_to_print:
            for i, demo in enumerate(demos_to_print):
                prompt_text += f"\n--- Example {i+1} ---\n"
                prompt_text += f"Sentence: {demo.sentence}\n"
                if hasattr(demo, 'reasoning') and demo.reasoning:
                    prompt_text += f"Reasoning: {demo.reasoning}\n"
                prompt_text += f"Key Words: {demo.key_words}\n"
        else:
            prompt_text += "\nNo examples were found.\n"
            
        with open(txt_save_path, 'w', encoding='utf-8') as f:
            f.write(prompt_text)
            
    except Exception as e:
        print("Could not generate text prompt preview: ", e)
    
    return {
        "status": "success", 
        "message": f"Optimization complete! Saved JSON to {model_save_path} and text preview to {txt_save_path}",
        "dataset_size": len(my_trainset)
    }

if __name__ == "__main__":
    # Sample data for your Reading App
    sample_texts = [
        "However, if it rains tomorrow, we will not be able to run fast in the park.",
        "He usually doesn't like to swim, because the water is too cold.",
        "They should have known that the mission was compromised."
    ]

    # Step A: Human Selection Mode
    print("Starting Human Annotation Mode...")
    my_trainset = collect_human_feedback(sample_texts)

    # Step B: Optimization (The 'Prompt Tuning' phase)
    if len(my_trainset) > 0:
        res = optimize_prompt()
        print(res["message"])
    else:
        print("No data collected. Optimization aborted.")