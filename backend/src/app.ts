import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import deviceRoutes from './routes/devices';
import monitoringRoutes from './routes/monitoring';
import './services/mqtt'; // Initialize MQTT client

import { rateLimit } from 'express-rate-limit';

dotenv.config();

const app = express();

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 100, // Limit each IP to 100 requests per `window`
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use('/api/', limiter);

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/monitoring', monitoringRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
