import app from './app';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { initSocket } from './services/socket';
import { startOfflineDetection } from './services/offlineDetection';
import { startThrottlingService } from './services/notificationThrottling';
import { startHourlyReports } from './services/scheduledReports';
import { startSyntheticRunner } from './services/SyntheticRunner';
import { startLicenseMonitoring } from './services/licenseMonitoring';
import { seedMonitoringTemplates, seedDefaultNotificationChannel } from './seedMonitoring';

if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET environment variable is required');
    process.exit(1);
}

const PORT = process.env.PORT || 5001;
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

        // Start monitoring services
        console.log('Starting monitoring services...');
        startOfflineDetection();
        startThrottlingService();
        startHourlyReports();
        startSyntheticRunner();
        startLicenseMonitoring();
        console.log('All monitoring services started');
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    });
