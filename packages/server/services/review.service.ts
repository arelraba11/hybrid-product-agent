import { reviewRepository } from '../repositories/review.repository';
import { llm } from '../llm';
import template from '../prompts/summarize-reviews.txt';

export const reviewService = {
   async summarizeReviews(productId: number): Promise<string> {
      const exisitingSummary =
         await reviewRepository.getReviewSummary(productId);
      if (exisitingSummary) {
         return exisitingSummary;
      }

      const reviews = await reviewRepository.getReviews(productId, 10);
      const joinedReviews = reviews.map((r) => r.content).join('\n\n');
      const prompt = template.replace('{{reviews}}', joinedReviews);
      const summary = await llm.generate('reviews', {
         prompt,
         temperature: 0.2,
      });
      await reviewRepository.storeReviewSummary(productId, summary);

      return summary;
   },
};
