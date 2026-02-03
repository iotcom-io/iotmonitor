import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import deviceRoutes from './routes/devices';
import monitoringRoutes from './routes/monitoring';
import settingsRoutes from './routes/settings';
import syntheticRoutes from './routes/synthetics';
import './services/mqtt'; // Initialize MQTT client

dotenv.config();

const app = express();

app.use(express.json());
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/synthetics', syntheticRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
