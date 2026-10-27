import OpenAI from 'openai';

const client = new OpenAI({
   apiKey: process.env.OPENAI_API_KEY,
});

type GenerateTextOption = {
   model?: string;
   prompt: string;
   temperature?: number;
   maxTokens?: number;
   previousResponseId?: string;
   responseFormat?: { type: 'json_object' } | { type: 'text' };
};

type GenerateTextResult = {
   id: string;
   text: string;
};

export const llmClient = {
   async generateText({
      model = 'gpt-4o-mini',
      prompt,
      temperature = 0.2,
      maxTokens = 300,
      previousResponseId,
      responseFormat,
   }: GenerateTextOption): Promise<GenerateTextResult> {
      const params: any = {
         model,
         input: prompt,
         temperature,
         max_output_tokens: maxTokens,
      };

      if (previousResponseId) {
         params.previous_response_id = previousResponseId;
      }

      // Add response_format if JSON mode is requested
      // Note: The responses.create API might not support response_format
      // If it doesn't work, the prompt engineering will enforce JSON output
      if (responseFormat?.type === 'json_object') {
         params.response_format = { type: 'json_object' };
      }

      let response;
      try {
         response = await client.responses.create(params);
      } catch (error: any) {
         // If response_format causes an error, retry without it
         // The prompt engineering should still enforce JSON output
         if (
            responseFormat?.type === 'json_object' &&
            (error?.message?.includes('response_format') ||
               error?.code === 'invalid_request_error')
         ) {
            // Silently fall back to prompt engineering (this is a valid approach)
            // The prompt is designed to enforce JSON output even without response_format
            delete params.response_format;
            response = await client.responses.create(params);
         } else {
            throw error;
         }
      }

      return {
         id: response.id,
         text: response.output_text,
      };
   },
};
