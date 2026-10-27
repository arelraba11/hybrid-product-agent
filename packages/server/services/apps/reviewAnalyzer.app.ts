import { z } from 'zod';
import { llmClient } from '../../llm/client';
import { reviewAnalyzerPrompt, reviewFixPrompt } from '../../prompts/prompts';

const AspectSchema = z.object({
   topic: z.string().min(1),
   sentiment: z.enum(['Positive', 'Negative', 'Neutral']),
   detail: z.string().min(1),
});

const ReviewAnalysisSchema = z.object({
   summary: z.string().min(1),
   overall_sentiment: z.enum(['Positive', 'Negative', 'Neutral', 'Mixed']),
   score: z.number().int().min(1).max(10),
   aspects: z.array(AspectSchema),
});

export type ReviewAnalysis = z.infer<typeof ReviewAnalysisSchema>;

function stripMarkdownJson(text: string) {
   let t = text.trim();
   if (t.startsWith('```json')) t = t.replace(/^```json\s*/i, '');
   if (t.startsWith('```')) t = t.replace(/^```\s*/i, '');
   if (t.endsWith('```')) t = t.replace(/\s*```$/, '');
   return t.trim();
}

function parseJsonSafely(text: string): unknown {
   const cleaned = stripMarkdownJson(text);
   return JSON.parse(cleaned);
}

function needsSanityFix(a: ReviewAnalysis) {
   return a.overall_sentiment === 'Positive' && a.score < 4;
}

async function analyzeOnce(reviewText: string): Promise<ReviewAnalysis> {
   const prompt = reviewAnalyzerPrompt.replace('{{REVIEW_TEXT}}', reviewText);
   const r = await llmClient.generateText({
      model: 'gpt-4o-mini',
      prompt,
      temperature: 0,
      maxTokens: 450,
      responseFormat: { type: 'json_object' },
   });

   console.log('🔍 REVIEW_ANALYZER RAW JSON:', r.text);

   const obj = parseJsonSafely(r.text);
   return ReviewAnalysisSchema.parse(obj);
}

async function fixInconsistency(
   reviewText: string,
   badJson: unknown
): Promise<ReviewAnalysis> {
   const prompt = reviewFixPrompt
      .replace('{{REVIEW_TEXT}}', reviewText)
      .replace('{{BAD_JSON}}', JSON.stringify(badJson, null, 2));

   const r = await llmClient.generateText({
      model: 'gpt-4o-mini',
      prompt,
      temperature: 0,
      maxTokens: 450,
      responseFormat: { type: 'json_object' },
   });

   console.log('🔁 REVIEW_FIX RAW JSON:', r.text);

   const obj = parseJsonSafely(r.text);
   return ReviewAnalysisSchema.parse(obj);
}

export async function analyzeReviewWithSelfCorrection(
   reviewText: string
): Promise<ReviewAnalysis> {
   const analysis = await analyzeOnce(reviewText);
   if (!needsSanityFix(analysis)) return analysis;

   console.log('🧪 Sanity check triggered: Positive sentiment with low score', {
      overall_sentiment: analysis.overall_sentiment,
      score: analysis.score,
   });

   return await fixInconsistency(reviewText, analysis);
}
