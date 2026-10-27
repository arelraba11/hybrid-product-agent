import type { Request, Response } from 'express';
import z from 'zod';
import { routerService } from '../services/router.service';

const chatSchema = z.object({
   prompt: z.string().trim().min(1).max(1000),
   conversationId: z.uuid(),
});

export const chatController = {
   async sendMessage(req: Request, res: Response) {
      console.log('CHAT CONTROLLER HIT ✅', req.body);

      const parseResult = chatSchema.safeParse(req.body);
      if (!parseResult.success) {
         res.status(400).json(z.treeifyError(parseResult.error));
         return;
      }

      try {
         const { prompt, conversationId } = parseResult.data;
         const out = await routerService.handleUserMessage(
            conversationId,
            prompt
         );
         res.json({ message: out.message });
      } catch (error) {
         res.status(500).json({ error: 'Failed to generate a response.' });
      }
   },
};
