require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const key = process.env.GEMINI_API_KEY || 'no-key';
console.log('Key length:', key.length);
if (key === 'no-key') process.exit(1);
const genAI = new GoogleGenerativeAI(key);

async function run() {
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  try {
     const result = await model.generateContent("hello");
     console.log(result.response.text());
  } catch(e) {
     console.error(e.message);
  }
}
run();
