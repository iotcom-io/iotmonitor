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
import incidentRoutes from './routes/incidents';
import notificationChannelRoutes from './routes/notificationChannels';
import templateRoutes from './routes/templates';
import './services/mqtt'; // Initialize MQTT client

dotenv.config();

const app = express();
const allowedOrigins = process.env.FRONTEND_ORIGIN
    ? process.env.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : true;

app.use(express.json());
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
}));
app.use(helmet());
app.use(morgan('dev'));

app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/synthetics', syntheticRoutes);
app.use('/api/web-monitoring', syntheticRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/notification-channels', notificationChannelRoutes);
app.use('/api/templates', templateRoutes);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default app;
