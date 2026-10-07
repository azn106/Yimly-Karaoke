import { Router } from 'express';
import { db, databaseCorrupted, databaseErrorMessage } from '../db/index.js';
import { users } from '../db/schema.js';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const router = Router();

const setupSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(1, 'Password is required'),
});

router.get('/status', async (req, res) => {
  if (databaseCorrupted) {
    return res.status(503).json({ error: databaseErrorMessage || 'Database corruption detected. Manual recovery required.' });
  }
  try {
    const adminExists = await db.select().from(users).where(eq(users.role, 'administrator')).limit(1);
    const isSetup = adminExists.length > 0;
    res.json({ isSetup });
  } catch (error) {
    console.error('Failed to check setup status:', error);
    res.status(500).json({ error: 'Failed to check setup status' });
  }
});

router.post('/', async (req, res) => {
  if (databaseCorrupted) {
    return res.status(503).json({ error: databaseErrorMessage || 'Database corruption detected. Manual recovery required.' });
  }
  try {
    const adminExists = await db.select().from(users).where(eq(users.role, 'administrator')).limit(1);
    if (adminExists.length > 0) {
      return res.status(403).json({ error: 'Setup has already been completed' });
    }

    const parsed = setupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid input', details: parsed.error.issues });
    }

    const { username, password } = parsed.data;

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await db.insert(users).values({
      username,
      password: hashedPassword,
      role: 'administrator',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({ id: users.id, username: users.username, role: users.role });

    res.json({ message: 'Setup completed successfully', user: newUser[0] });
  } catch (error) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Failed to complete setup' });
  }
});

export default router;
