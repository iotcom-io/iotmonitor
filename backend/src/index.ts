import app from './app';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { initSocket } from './services/socket';
import { startOfflineDetection } from './services/offlineDetection';
import { startThrottlingService } from './services/notificationThrottling';
import { startHourlyReports } from './services/scheduledReports';
import { seedMonitoringTemplates, seedDefaultNotificationChannel } from './seedMonitoring';

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iotmonitor';

const httpServer = createServer(app);

mongoose.connect(MONGODB_URI)
    .then(async () => {
        console.log('Connected to MongoDB');

        // Seed monitoring data
        await seedMonitoringTemplates();
        await seedDefaultNotificationChannel();

        // Initialize Socket.IO with the HTTP server
        initSocket(httpServer);

        httpServer.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        // Start enhanced monitoring services
        console.log('🔍 Starting enhanced monitoring services...');
        startOfflineDetection(); // Check every 30s for offline devices
        startThrottlingService(); // Process throttled alerts every minute
        startHourlyReports(); // Send hourly status updates
        console.log('✅ All monitoring services started');
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    });
