import { Server } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server;

export const initSocket = (httpServer: HttpServer) => {
    io = new Server(httpServer, {
        cors: {
            origin: "*", // Adjust for production security
            methods: ["GET", "POST"]
        }
    });

    io.on('connection', (socket) => {
        console.log('Client connected to PlugSocket:', socket.id);

        socket.on('terminal:command', async (data: { device_id: string, command: string }) => {
            const { device_id, command } = data;
            if (!device_id || !command) return;

            try {
                const { publishCommand } = await import('./mqtt');
                // Wrap in sh -c to ensure shell features like pipes work
                publishCommand(device_id, {
                    command_id: Math.random().toString(36).substring(7),
                    payload: '/bin/sh',
                    args: ['-c', command],
                    timeout: 60
                });
            } catch (err) {
                console.error('[SOCKET] Failed to publish terminal command:', err);
                socket.emit(`terminal:output:${device_id}`, { error: 'Failed to dispatch command to device' });
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized!');
    }
    return io;
};
