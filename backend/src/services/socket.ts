import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt, { JwtPayload } from 'jsonwebtoken';
import User from '../models/User';
import Device from '../models/Device';
import { AuthUserContext, canAccessDevice, hasPermission, toAuthUserContext } from '../lib/rbac';

let io: Server;

interface TerminalCommandData {
    device_id: string;
    command: string;
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

const ALLOWED_TERMINAL_COMMANDS = new Set([
    'ls',
    'pwd',
    'df',
    'free',
    'uptime',
    'whoami',
    'hostname',
    'docker',
    'asterisk',
    'ip',
    'cat',
    'tail',
    'ps',
    'top',
]);

const SAFE_ARG_PATTERN = /^[a-zA-Z0-9_./:@=+,-]+$/;

const extractToken = (socket: Socket): string | null => {
    const authToken = socket.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.trim()) {
        return authToken.trim();
    }

    const headerAuth = socket.handshake.headers.authorization;
    if (typeof headerAuth === 'string' && headerAuth.startsWith('Bearer ')) {
        return headerAuth.slice(7).trim();
    }

    return null;
};

const parseSafeCommand = (rawCommand: string): { payload: string; args: string[] } | null => {
    const text = rawCommand.trim();
    if (!text) return null;

    // Block shell metacharacters to prevent command chaining/injection.
    if (/[|&;<>$`"'()]/.test(text)) {
        return null;
    }

    const parts = text.split(/\s+/);
    const payload = parts[0];
    const args = parts.slice(1);

    if (!ALLOWED_TERMINAL_COMMANDS.has(payload)) {
        return null;
    }

    if (!args.every((arg) => SAFE_ARG_PATTERN.test(arg))) {
        return null;
    }

    return { payload, args };
};

const parseSocketUser = async (token: string): Promise<AuthUserContext | null> => {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload & { id?: string };
    if (!decoded?.id) return null;

    const userDoc = await User.findById(decoded.id);
    if (!userDoc || userDoc.is_active === false) return null;

    return toAuthUserContext(userDoc);
};

export const initSocket = (httpServer: HttpServer) => {
    const allowedOrigins = process.env.FRONTEND_ORIGIN
        ? process.env.FRONTEND_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
        : true;

    io = new Server(httpServer, {
        cors: {
            origin: allowedOrigins,
            methods: ['GET', 'POST'],
            credentials: true,
        },
    });

    io.use(async (socket, next) => {
        try {
            const token = extractToken(socket);
            if (!token) {
                return next(new Error('Unauthorized'));
            }

            const user = await parseSocketUser(token);
            if (!user) {
                return next(new Error('Unauthorized'));
            }

            socket.data.user = user;
            next();
        } catch (_err) {
            next(new Error('Unauthorized'));
        }
    });

    io.on('connection', (socket) => {
        const user = socket.data.user as AuthUserContext;
        console.log('Socket client connected:', socket.id, user.role);

        socket.on('terminal:command', async (data: TerminalCommandData) => {
            const { device_id, command } = data || {};
            if (!device_id || !command) return;

            if (!hasPermission(user, 'remote_terminal.run')) {
                socket.emit(`terminal:output:${device_id}`, { error: 'Insufficient permissions for terminal command' });
                return;
            }

            if (!/^[a-zA-Z0-9_-]{4,64}$/.test(device_id)) {
                socket.emit(`terminal:output:${device_id}`, { error: 'Invalid device id format' });
                return;
            }

            const parsed = parseSafeCommand(command);
            if (!parsed) {
                socket.emit(`terminal:output:${device_id}`, {
                    error: 'Command rejected. Only allowlisted diagnostic commands are permitted.',
                });
                return;
            }

            try {
                const device = await Device.findOne({ device_id }).select({ device_id: 1, assigned_user_ids: 1 });
                if (!device || !canAccessDevice(user, device)) {
                    socket.emit(`terminal:output:${device_id}`, { error: 'Access denied for target device' });
                    return;
                }

                const { publishCommand } = await import('./mqtt');
                publishCommand(device_id, {
                    command_id: Math.random().toString(36).substring(2, 10),
                    payload: parsed.payload,
                    args: parsed.args,
                    timeout: 60,
                });
            } catch (err) {
                console.error('[SOCKET] Failed to publish terminal command:', err);
                socket.emit(`terminal:output:${device_id}`, { error: 'Failed to dispatch command to device' });
            }
        });

        socket.on('disconnect', () => {
            console.log('Socket client disconnected:', socket.id);
        });
    });

    return io;
};

export const getIO = () => {
    if (!io) {
        throw new Error('Socket.io not initialized');
    }
    return io;
};
