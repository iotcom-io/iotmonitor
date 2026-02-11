import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User, { UserRole } from '../models/User';
import { AuthUserContext, PermissionKey, hasPermission, toAuthUserContext } from '../lib/rbac';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is required');
}

export interface AuthRequest extends Request {
    user?: AuthUserContext;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role?: UserRole };
        if (!decoded?.id) {
            return res.status(401).json({ message: 'Token is not valid' });
        }

        User.findById(decoded.id)
            .then((userDoc) => {
                if (!userDoc || userDoc.is_active === false) {
                    return res.status(401).json({ message: 'User is disabled or not found' });
                }

                req.user = toAuthUserContext(userDoc);
                next();
            })
            .catch(() => {
                res.status(401).json({ message: 'Token is not valid' });
            });
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

export const authorize = (roles: string[]) => {
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user || !roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied' });
        }
        next();
    };
};

export const authorizePermission = (permissions: PermissionKey | PermissionKey[]) => {
    const required = Array.isArray(permissions) ? permissions : [permissions];
    return (req: AuthRequest, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const allowed = required.every((permission) => hasPermission(req.user, permission));
        if (!allowed) {
            return res.status(403).json({ message: 'Insufficient permissions' });
        }

        next();
    };
};
