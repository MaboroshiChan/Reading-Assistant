const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI('test');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
const chat = model.startChat({ systemInstruction: "test" });
console.log(typeof chat.sendMessageStream);
