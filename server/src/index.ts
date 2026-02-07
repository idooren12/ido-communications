import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import antennaRoutes from './routes/antennas';
import historyRoutes from './routes/history';
import weatherRoutes from './routes/weather';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.FRONTEND_URL || true
    : true,
  credentials: true
}));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).send('OK');
});

app.use('/api/auth', authRoutes);
app.use('/api/antennas', antennaRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/weather', weatherRoutes);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
