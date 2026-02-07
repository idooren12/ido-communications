import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = Router();
const prisma = new PrismaClient();

// All antenna routes require authentication
router.use(authenticateToken);

// List user's antennas
router.get('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const antennas = await prisma.antenna.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ antennas });
  } catch (error) {
    console.error('List antennas error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create antenna
router.post('/', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, powerWatts, gainDbi, frequencyMhz, notes } = req.body;

    if (!name || powerWatts === undefined || gainDbi === undefined) {
      res.status(400).json({ error: 'Name, power, and gain are required' });
      return;
    }

    const antenna = await prisma.antenna.create({
      data: {
        name,
        powerWatts: parseFloat(powerWatts),
        gainDbi: parseFloat(gainDbi),
        ...(frequencyMhz !== undefined && { frequencyMhz: parseFloat(frequencyMhz) }),
        ...(notes !== undefined && { notes }),
        userId: req.userId!
      }
    });

    res.status(201).json({ antenna });
  } catch (error) {
    console.error('Create antenna error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update antenna
router.put('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { name, powerWatts, gainDbi, frequencyMhz, notes } = req.body;

    // Verify ownership
    const existing = await prisma.antenna.findFirst({
      where: { id, userId: req.userId as string }
    });

    if (!existing) {
      res.status(404).json({ error: 'Antenna not found' });
      return;
    }

    const antenna = await prisma.antenna.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(powerWatts !== undefined && { powerWatts: parseFloat(powerWatts) }),
        ...(gainDbi !== undefined && { gainDbi: parseFloat(gainDbi) }),
        ...(frequencyMhz !== undefined && { frequencyMhz: frequencyMhz === null ? null : parseFloat(frequencyMhz) }),
        ...(notes !== undefined && { notes: notes === null ? null : notes })
      }
    });

    res.json({ antenna });
  } catch (error) {
    console.error('Update antenna error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete antenna
router.delete('/:id', async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.antenna.findFirst({
      where: { id, userId: req.userId as string }
    });

    if (!existing) {
      res.status(404).json({ error: 'Antenna not found' });
      return;
    }

    await prisma.antenna.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error('Delete antenna error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
