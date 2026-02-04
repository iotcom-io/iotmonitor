import app from './app';
import mongoose from 'mongoose';
import { createServer } from 'http';
import { startSummaryReporter } from './services/SummaryReporter';
import { startSyntheticRunner } from './services/SyntheticRunner';
import { initSocket } from './services/socket';

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/iotmonitor';

const httpServer = createServer(app);

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('Connected to MongoDB');

        // Initialize Socket.IO with the HTTP server
        initSocket(httpServer);

        httpServer.listen(PORT, () => {
            console.log(`Server is running on port ${PORT}`);
        });

        startSummaryReporter();
        startSyntheticRunner();
    })
    .catch((err) => {
        console.error('Failed to connect to MongoDB', err);
        process.exit(1);
    });
