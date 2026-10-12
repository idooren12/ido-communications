import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { authenticateToken, generateToken, AuthRequest } from '../middleware/auth';
import { authLimiter } from '../lib/rateLimits';
import { changePasswordSchema, credentialsSchema, loginSchema, preferencesSchema, validateBody } from '../lib/validation';

const router = Router();

const publicUser = { id: true, username: true, preferredLanguage: true, createdAt: true } as const;

// A real hash of a random string, compared against when the username does not exist,
// so a login for an unknown user takes as long as one with a wrong password.
const DUMMY_HASH = bcrypt.hashSync('timing-equalizer-not-a-real-password', 10);

router.post('/register', authLimiter, validateBody(credentialsSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { username, password } = req.body as { username: string; password: string };

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, passwordHash },
      select: publicUser,
    });

    res.status(201).json({ user, token: generateToken(user.id) });
  } catch (error) {
    // Unique constraint on username (also covers two registrations racing each other).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'Username already taken' });
      return;
    }
    throw error;
  }
});

router.post('/login', authLimiter, validateBody(loginSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { username, password } = req.body as { username: string; password: string };

  const user = await prisma.user.findUnique({ where: { username } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      preferredLanguage: user.preferredLanguage,
      createdAt: user.createdAt,
    },
    token: generateToken(user.id),
  });
});

router.get('/me', authenticateToken, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: publicUser });

  if (!user) {
    // The account behind a valid token no longer exists: treat as an auth failure.
    res.status(401).json({ error: 'User not found' });
    return;
  }

  res.json({ user });
});

router.put('/preferences', authenticateToken, validateBody(preferencesSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { preferredLanguage } = req.body as { preferredLanguage: 'he' | 'en' };

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: { preferredLanguage },
    select: publicUser,
  });

  res.json({ user });
});

router.put('/password', authenticateToken, authLimiter, validateBody(changePasswordSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });

  res.json({ success: true });
});

export default router;
