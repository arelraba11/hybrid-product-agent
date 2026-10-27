import { z } from 'zod';
import { llm } from '../../llm';
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

function needsSanityFix(a: ReviewAnalysis) {
   return a.overall_sentiment === 'Positive' && a.score < 4;
}

async function analyzeOnce(reviewText: string): Promise<ReviewAnalysis> {
   const prompt = reviewAnalyzerPrompt.replace('{{REVIEW_TEXT}}', reviewText);
   const { raw, data } = await llm.generateObject(
      'reviews',
      ReviewAnalysisSchema,
      'review_analysis',
      { prompt, temperature: 0 }
   );

   console.log('🔍 REVIEW_ANALYZER RAW JSON:', raw);
   return data;
}

async function fixInconsistency(
   reviewText: string,
   badJson: unknown
): Promise<ReviewAnalysis> {
   const prompt = reviewFixPrompt
      .replace('{{REVIEW_TEXT}}', reviewText)
      .replace('{{BAD_JSON}}', JSON.stringify(badJson, null, 2));

   const { raw, data } = await llm.generateObject(
      'reviews',
      ReviewAnalysisSchema,
      'review_analysis',
      { prompt, temperature: 0 }
   );

   console.log('🔁 REVIEW_FIX RAW JSON:', raw);
   return data;
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
