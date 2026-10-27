import { generalChatPromptLocal } from '../../prompts/prompts';
import { callLocalLLM } from '../../llm/ollama.client';
import type { ChatMessage } from '../../repositories/history.repository';

function historyToText(history: ChatMessage[]) {
   return history
      .slice(-20) // keep it small to avoid huge prompts
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n');
}

function checkGuardrails(userInput: string): string | null {
   const input = userInput.toLowerCase();

   // Check for political content (Hebrew and English keywords)
   const politicalKeywords = [
      'פוליטיקה',
      'פוליטי',
      'מפלגה',
      'ביבי',
      'לפיד',
      'בנט',
      'politics',
      'political',
      'election',
      'vote',
      'democrat',
      'republican',
   ];

   // Check for malicious code requests
   const malwareKeywords = [
      'וירוס',
      'מלטוור',
      'האק',
      'פרצה',
      'exploit',
      'malware',
      'virus',
      'trojan',
      'hack',
      'exploit code',
      'write a virus',
      'create malware',
   ];

   // Check for illegal activities
   const illegalKeywords = [
      'סמים',
      'אלימות',
      'פצצה',
      'drugs',
      'illegal',
      'bomb',
      'weapon',
   ];

   for (const keyword of politicalKeywords) {
      if (input.includes(keyword)) {
         return 'I cannot process this request: political discussions are not within my scope due to safety protocols.';
      }
   }

   for (const keyword of malwareKeywords) {
      if (input.includes(keyword)) {
         return 'I cannot process this request: writing malicious code violates safety protocols.';
      }
   }

   for (const keyword of illegalKeywords) {
      if (input.includes(keyword)) {
         return `I cannot process this request: ${keyword} related content due to safety protocols.`;
      }
   }

   return null;
}

export async function generalChat(history: ChatMessage[], userInput: string) {
   // Check guardrails first
   const guardrailResponse = checkGuardrails(userInput);
   if (guardrailResponse) {
      console.log('🛡️ Guardrail triggered for input:', userInput);
      return { id: 'guardrail', message: guardrailResponse };
   }

   const historyBlock = history.length ? historyToText(history) : '(empty)';

   const fullPrompt = `
${generalChatPromptLocal}

Conversation history:
${historyBlock}

User: ${userInput}
Assistant:
`.trim();

   const text = await callLocalLLM(fullPrompt);

   return { id: 'ollama-local', message: text };
}
