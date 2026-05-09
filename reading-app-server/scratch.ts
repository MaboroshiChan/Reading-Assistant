import { GoogleGenerativeAI } from '@google/generative-ai';
const genAI = new GoogleGenerativeAI('key');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
const chat = model.startChat({});
// Can we pass generationConfig to sendMessageStream?
