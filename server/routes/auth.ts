import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_dev';

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const userResult = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (userResult.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = userResult[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      console.log(`[LOGIN REQUEST] authentication failure: invalid password for user ${username}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`[LOGIN REQUEST] authentication success for user ${username}`);

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.cookie('yimly_token', token, {
      httpOnly: true,
      secure: true, // Always true for AI Studio iframe
      sameSite: 'none', // Needed for iframe
      partitioned: true, // Needed for Chrome third-party cookie blocking
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    } as any);

    console.log(`[LOGIN REQUEST] cookie/session creation: yimly_token cookie set with secure=true, sameSite=none, Partitioned`);

    res.json({
      message: 'Logged in successfully',
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      },
      token
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('yimly_token', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    partitioned: true
  } as any);
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

export default router;
