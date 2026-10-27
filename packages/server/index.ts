import express from 'express';
import dotenv from 'dotenv';
import router from './routes';
import { historyRepository } from './repositories/history.repository';

dotenv.config();

const app = express();
app.use(express.json());
app.use(router);

const PORT = process.env.PORT || 3000;

const startServer = async () => {
   const info = await historyRepository.load();

   if (info.loaded) {
      console.log(`ברוך שובך! נטענו ${info.conversations} שיחות מהיסטוריה`);
   } else {
      console.log('התחלנו שיחה חדשה (אין history.json)');
   }

   app.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
   });
};

startServer();
