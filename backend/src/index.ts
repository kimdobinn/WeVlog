import dotenv from 'dotenv';
dotenv.config();

import express, {Request, Response} from 'express';
import cors from 'cors';
import './config/supabase';
import authRoutes from './routes/auth';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use((express.json()));
app.use('/api/auth', authRoutes);

app.get('/', (req: Request, res: Response) => {res.json({ message: 'WeVlog API is running' });});
app.listen(PORT, () => {console.log(`server is running fine on port ${PORT}`);});

export default app;