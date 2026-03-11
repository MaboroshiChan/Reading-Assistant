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
class KeywordExtraction(dspy.Signature):
    """Extract the most semantically significant text pieces (key words) from a sentence.
    
    Guidelines for key words:
    - Include the predicate with its modifiers (e.g., "runs", "runs fast", "is eradicated", "did not say").
    - Include subclause markers (e.g., "that", "which", "who", "because", "since", "although", "while", "if", "unless", "whether", "how", "why", "when", "where", "as"). 
    - Include connectors (e.g., "and", "or", "because").
    - Include negation words (e.g., "not", "nothing", "doesn't", "don't", "isn't").
    - Include infinitives with its modifiers (e.g., "to run", "to be run").
    - Include adverbs that modify the whole sentence (e.g., "However", "Only", "Furthermore").
    - Include modal verbs (e.g., "can", "could", "should", "will", "would").
    - DO NOT include nouns and their modifiers.
    - Usually short (1-3 words). Do not include entire clauses.
    - Every sentence contains at least one key_word.
    """
    sentence = dspy.InputField(desc="A single sentence to be analyzed")
    key_words = dspy.OutputField(desc="Comma-separated list of extracted key words, adhering precisely to the guidelines")

# Define the base module with Chain of Thought
extractor = dspy.ChainOfThought(KeywordExtraction)

# ======================================================
# 3. Human Feedback Collection Logic
# ======================================================
def collect_human_feedback(raw_sentences, save_path="golden_dataset.json"):
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
            # We use a direct call to simulate different prompt variations
            prompt = (
                f"Extract the key words from this sentence using a '{s}' approach. "
                f"Follow these rules strictly: include predicates, subclause markers, connectors, negations, "
                f"infinitives, sentence adverbs, and modal verbs. DO NOT include nouns. Keep it short (1-3 words). "
                f"Output ONLY comma-separated keywords. "
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

    # Step B: Optimization (The 'Prompt Tuning' phase)
    if len(my_trainset) > 0:
        print("\n>>> Optimizing Prompt based on your preferences...")

        # Simple metric: keywords should not be empty, and hopefully no nouns (though harder to verify in code without NLP, so we do basic check)
        def simple_metric(example, pred, trace=None):
            return len(pred.key_words.strip()) > 0

        # BootstrapFewShot will take your 'Golden Examples' and bake them into the prompt
        optimizer = BootstrapFewShot(metric=simple_metric)
        compiled_app = optimizer.compile(extractor, trainset=my_trainset)

        # Step C: Testing the Optimized Prompt
        print("\n" + "*"*20 + " TESTING OPTIMIZED PROMPT " + "*"*20)
        test_case = "Furthermore, although she was exhausted, she decided to keep working on the project."
        final_output = compiled_app(sentence=test_case)
        
        print(f"Test Sentence: {test_case}")
        print(f"Final Optimized Output (Key words): {final_output.key_words}")

        # Save the compiled program (this includes your chosen few-shot examples)
        compiled_app.save("optimized_reading_agent.json")
        print("\nOptimization Complete! Configuration saved to optimized_reading_agent.json")
    else:
        print("No data collected. Optimization aborted.")