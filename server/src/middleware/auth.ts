import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config';

export interface AuthRequest extends Request {
  userId?: string;
}

export function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const [scheme, token] = authHeader ? authHeader.split(' ') : [];

  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { userId?: unknown };
    if (typeof decoded.userId !== 'string') {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function generateToken(userId: string): string {
  return jwt.sign({ userId }, JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
}
