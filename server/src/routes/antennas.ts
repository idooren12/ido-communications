import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { createAntennaSchema, updateAntennaSchema, validateBody } from '../lib/validation';
import type { z } from 'zod';

const router = Router();

router.use(authenticateToken);

router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  const antennas = await prisma.antenna.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ antennas });
});

router.post('/', validateBody(createAntennaSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const data = req.body as z.infer<typeof createAntennaSchema>;

  const antenna = await prisma.antenna.create({
    data: { ...data, userId: req.userId! },
  });

  res.status(201).json({ antenna });
});

router.put('/:id', validateBody(updateAntennaSchema), async (req: AuthRequest, res: Response): Promise<void> => {
  const data = req.body as z.infer<typeof updateAntennaSchema>;

  // updateMany scopes the write to the owner in a single query.
  const { count } = await prisma.antenna.updateMany({
    where: { id: String(req.params.id), userId: req.userId },
    data,
  });

  if (count === 0) {
    res.status(404).json({ error: 'Antenna not found' });
    return;
  }

  const antenna = await prisma.antenna.findUnique({ where: { id: String(req.params.id) } });
  res.json({ antenna });
});

router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  const { count } = await prisma.antenna.deleteMany({
    where: { id: String(req.params.id), userId: req.userId },
  });

  if (count === 0) {
    res.status(404).json({ error: 'Antenna not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
