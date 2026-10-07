import { Router } from 'express';
import { db } from '../db/index.js';
import { users, playlists, playlistSongs, controllers, sessions, queueItems } from '../db/schema.js';
import { eq, ne, and, inArray } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

const userCreateSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(1, 'Password is required'),
  role: z.enum(['administrator', 'user']).default('user'),
});

const userUpdateSchema = z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(1).optional().or(z.literal('')),
  role: z.enum(['administrator', 'user']).default('user'),
});

router.get('/', async (req, res) => {
  try {
    const allUsers = await db.select({
      id: users.id,
      username: users.username,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users);
    res.json(allUsers);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/', async (req, res) => {
  try {
    const parsed = userCreateSchema.parse(req.body);

    const existingUser = await db.select().from(users).where(eq(users.username, parsed.username)).limit(1);
    if (existingUser.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const hashedPassword = await bcrypt.hash(parsed.password, 10);
    const newUser = await db.insert(users).values({
      username: parsed.username,
      password: hashedPassword,
      role: parsed.role,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({
      id: users.id,
      username: users.username,
      role: users.role,
    });

    res.json(newUser[0]);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to create user' });
    }
  }
});

router.put('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user ID' });
    
    const parsed = userUpdateSchema.parse(req.body);

    // Check if new username is already taken by another user
    const duplicate = await db.select().from(users)
      .where(and(eq(users.username, parsed.username), ne(users.id, id)))
      .limit(1);
    if (duplicate.length > 0) {
      return res.status(400).json({ error: 'Username is already in use by another account' });
    }

    const updateData: any = {
      username: parsed.username,
      role: parsed.role,
      updatedAt: new Date(),
    };

    if (parsed.password && parsed.password.length > 0) {
      updateData.password = await bcrypt.hash(parsed.password, 10);
    }

    // Check if modifying self role
    const reqUser = (req as any).user;
    if (reqUser.id === id && parsed.role !== 'administrator') {
      return res.status(400).json({ error: 'Cannot remove your own administrator role' });
    }

    const updatedUser = await db.update(users).set(updateData).where(eq(users.id, id)).returning({
      id: users.id,
      username: users.username,
      role: users.role,
    });

    if (updatedUser.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(updatedUser[0]);
  } catch (error) {
     if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.issues });
    } else {
      res.status(500).json({ error: 'Failed to update user' });
    }
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid user ID' });
    }
    const reqUser = (req as any).user;

    if (reqUser.id === id) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    // 1. Clean up user playlists and songs
    const userPlaylists = await db.select({ id: playlists.id }).from(playlists).where(eq(playlists.userId, id));
    if (userPlaylists.length > 0) {
      const playlistIds = userPlaylists.map(p => p.id);
      await db.delete(playlistSongs).where(inArray(playlistSongs.playlistId, playlistIds));
      await db.delete(playlists).where(eq(playlists.userId, id));
    }

    // 2. Unlink user from controllers
    await db.update(controllers).set({ userId: null }).where(eq(controllers.userId, id));

    // 3. Unlink user from queue items
    try {
      await db.update(queueItems).set({ userId: null }).where(eq(queueItems.userId, id));
    } catch (e) {
      // ignore
    }

    // 4. Clean up sessions hosted by this user
    const userSessions = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.hostId, id));
    if (userSessions.length > 0) {
      for (const s of userSessions) {
        await db.delete(queueItems).where(eq(queueItems.sessionId, s.id));
        await db.delete(controllers).where(eq(controllers.sessionId, s.id));
      }
      await db.delete(sessions).where(eq(sessions.hostId, id));
    }

    const deleted = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
    if (deleted.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Failed to delete user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
