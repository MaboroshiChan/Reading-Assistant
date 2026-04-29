require('dotenv').config();
const key = process.env.GEMINI_API_KEY;
async function run() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
  const data = await res.json();
  console.log(data.models?.map(m => m.name).join('\n'));
}
run();
