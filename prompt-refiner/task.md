# Prompt Refiner Task: Sentence Highlighting Feedback Loop

## 1. Overview and Goal
The goal of this task is to build a human-in-the-loop (HITL) prompt refinement system. Specifically, we want to improve the prompt used for generating sentence keyword highlighting. 
By collecting human feedback on AI-generated highlights, we can build a golden dataset, evaluate performance, and leverage DSPy (e.g., `prompt-refiner/dspy.py`) to automatically compile and optimize the prompt over time.

## 2. The Human Feedback Loop Workflow
1. **Generation:** The system takes a sentence and runs it through multiple variations of prompts or models to generate different keyword highlighting candidates.
2. **Review:** A human reviewer inspects the original sentence alongside the generated candidates in a dedicated web interface.
3. **Selection/Editing:** The human chooses the best candidate. If none are perfect, the human can manually edit a candidate to create the ideal highlight.
4. **Storage:** The approved/edited highlight is saved as a pair of `(original_sentence, golden_highlight)` in a structured format (e.g., `golden_dataset.json`).
5. **Optimization:** DSPy consumes this golden dataset to systematically refine the highlighting prompt using `BootstrapFewShot` or similar optimizers.

## 3. Frontend UI Requirements
- **Reusability:** We already have a frontend that renders sentence keyword highlighting. We will copy/adapt this UI to serve as the visual component for the feedback tool.
- **Candidate Display:** The UI must display *multiple* candidate highlighting results for a single sentence simultaneously, allowing side-by-side comparison.
- **Selection Mechanism:** The reviewer must be able to easily select the "best" candidate (e.g., via a straightforward "Select" button).
- **Manual Editing:** The reviewer must have the ability to manually adjust the highlight boundaries (select/deselect words) to construct the perfect highlight if the AI fell short.
- **Submission:** A "Save to Dataset" button to confirm the choice and advance to the next sentence in the queue.

## 4. Backend / API Requirements
- **Generation Endpoint:** An endpoint to fetch multiple generated candidate highlights for a given text snippet.
- **Feedback Endpoint:** An endpoint to receive the human's final choice (or edited text) and save it to the local golden dataset.
- **Data Source:** Ability to pull raw, unannotated sentences from an existing database or sample text file to feed into the UI queue.

## 5. DSPy Integration
- Update the DSPy pipeline to ingest the JSON dataset created by the frontend.
- Define a DSPy signature focused on sentence highlighting: e.g., mapping `sentence` to `highlighted_keywords`.
- Use DSPy's teleprompters (like `BootstrapFewShot`) to inject the human-selected golden examples into the prompt dynamically, ensuring the highlighting quality improves continuously.
