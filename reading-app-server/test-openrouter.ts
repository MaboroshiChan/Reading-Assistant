import './src/config/runtime-config';
import { createLLMClient } from './services/llmService';

async function main() {
  console.log('Testing OpenRouter API...');
  try {
    const client = createLLMClient({
      systemPrompt: 'You are a helpful test assistant. Keep your answer under 10 words.',
      model: 'qwen/qwen3-32b'
    });

    console.log('Sending request: "Say hello to my local testing setup!"');
    const result = await client.complete('Say hello to my local testing setup!');
    console.log('\n--- Response ---');
    console.log(result.text);
    console.log('----------------\n');
    console.log('Usage:', await result.usage);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

main();
