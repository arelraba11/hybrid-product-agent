// packages/server/llm/ollama.client.ts

const OLLAMA_BASE_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3:latest';

function buildGenerateUrl() {
   return `${OLLAMA_BASE_URL.replace(/\/$/, '')}/api/generate`;
}

export async function callLocalLLM(prompt: string): Promise<string> {
   const body = {
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
         temperature: 0,
         num_predict: 120,
         stop: ['\n\n', '\n##', '\n###', '```', 'INPUT:', 'Rules:'],
      },
   };

   const res = await fetch(buildGenerateUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
   });

   if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
         `Ollama error: ${res.status} ${res.statusText} - ${text}`
      );
   }

   const data: any = await res.json();
   return data.response as string;
}
