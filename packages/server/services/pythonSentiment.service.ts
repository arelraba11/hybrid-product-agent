const PY_SENTIMENT_URL =
   process.env.PY_SENTIMENT_URL || 'http://localhost:8000/analyze';

export type PythonSentimentResult = {
   sentiment: string;
   confidence: number;
};

export async function callPythonSentiment(
   text: string
): Promise<PythonSentimentResult> {
   const res = await fetch(PY_SENTIMENT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
   });

   if (!res.ok) {
      throw new Error(
         `Python sentiment service error: ${res.status} ${res.statusText}`
      );
   }

   return (await res.json()) as PythonSentimentResult;
}
