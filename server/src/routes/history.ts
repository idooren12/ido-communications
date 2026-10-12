import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { calculationSchema, validateBody } from '../lib/validation';
import type { z } from 'zod';

const router = Router();

export const HISTORY_LIMIT = 20;

router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const calculations = await prisma.calculation.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_LIMIT,
  });
  res.json({ calculations });
});

router.post('/', validateBody(calculationSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const body = req.body as z.infer<typeof calculationSchema>;
  const userId = req.userId!;

  const calculation = await prisma.$transaction(async tx => {
    const created = await tx.calculation.create({
      data: {
        userId,
        mode: body.mode,
        txPowerWatts: body.txPowerWatts,
        txGainDbi: body.txGainDbi,
        rxGainDbi: body.rxGainDbi,
        frequencyMhz: body.frequencyMhz,
        sensitivity: body.sensitivity ?? null,
        distance: body.distance ?? null,
        resultValue: body.resultValue,
      },
    });

    // Keep only the most recent HISTORY_LIMIT entries.
    const stale = await tx.calculation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: HISTORY_LIMIT,
      select: { id: true },
    });
    if (stale.length > 0) {
      await tx.calculation.deleteMany({ where: { id: { in: stale.map(c => c.id) } } });
    }

    return created;
  });

  res.status(201).json({ calculation });
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { count } = await prisma.calculation.deleteMany({
    where: { id: String(req.params.id), userId: req.userId },
  });

  if (count === 0) {
    res.status(404).json({ error: 'Calculation not found' });
    return;
  }

  res.json({ success: true });
});

router.delete('/', async (req: AuthRequest, res: Response): Promise<void> => {
  await prisma.calculation.deleteMany({ where: { userId: req.userId } });
  res.json({ success: true });
});

export default router;
