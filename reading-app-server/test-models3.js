require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const key = process.env.GEMINI_API_KEY;
if (!key) process.exit(1);
const genAI = new GoogleGenerativeAI(key);

async function testModel(modelName) {
  try {
     const model = genAI.getGenerativeModel({ model: modelName });
     const result = await model.generateContent("hello");
     console.log(`✅ ${modelName} works. Output: ${result.response.text().trim()}`);
  } catch(e) {
     console.error(`❌ ${modelName} failed: ${e.message.split('\n')[0]}`);
  }
}

async function run() {
  await testModel('gemini-2.5-flash');
  await testModel('gemini-flash-latest');
  await testModel('gemini-2.5-pro');
  await testModel('gemma-3-27b-it');
}
run();
