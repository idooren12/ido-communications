import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// Get calculation history (most recent 20)
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const calculations = await prisma.calculation.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ calculations });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Save a calculation
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { mode, txPowerWatts, txGainDbi, rxGainDbi, frequencyMhz, sensitivity, distance, resultValue } = req.body;

    const calculation = await prisma.calculation.create({
      data: {
        userId: req.userId!,
        mode,
        txPowerWatts,
        txGainDbi,
        rxGainDbi,
        frequencyMhz,
        sensitivity: sensitivity ?? null,
        distance: distance ?? null,
        resultValue,
      },
    });

    // Keep only most recent 20
    const all = await prisma.calculation.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      skip: 20,
    });
    if (all.length > 0) {
      await prisma.calculation.deleteMany({
        where: { id: { in: all.map(c => c.id) } },
      });
    }

    res.json({ calculation });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a single calculation
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.calculation.deleteMany({
      where: { id, userId: req.userId },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear all history
router.delete('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await prisma.calculation.deleteMany({
      where: { userId: req.userId },
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
