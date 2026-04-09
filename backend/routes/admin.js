// routes/admin.js
import express from 'express';
import { supabase } from '../lib/supabase.js';

const router = express.Router();

// Auth middleware
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user;
  next();
}

async function requireAdmin(req, res, next) {
  await requireAuth(req, res, async () => {
    if (!req.user?.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  });
}

// Get platform stats
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const [usersCount, listingsCount, transactionsCount] = await Promise.all([
      supabase.from('users').select('*', { count: 'exact', head: true }),
      supabase.from('listings').select('*', { count: 'exact', head: true }),
      supabase.from('transactions').select('*', { count: 'exact', head: true }),
    ]);

    res.json({
      totalUsers: usersCount.count || 0,
      totalListings: listingsCount.count || 0,
      totalTransactions: transactionsCount.count || 0,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('id, username, email, is_banned, vip_tier, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ users: data });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Ban user
router.post('/users/:userId/ban', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { error } = await supabase
      .from('users')
      .update({ is_banned: true, banned_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;
    res.json({ success: true, message: 'User banned' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Unban user
router.post('/users/:userId/unban', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { error } = await supabase
      .from('users')
      .update({ is_banned: false, banned_at: null })
      .eq('id', userId);

    if (error) throw error;
    res.json({ success: true, message: 'User unbanned' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
