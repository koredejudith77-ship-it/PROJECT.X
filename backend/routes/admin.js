// routes/admin.js
import express from 'express';
import { supabase } from '../lib/supabase.js';
import { AdminController } from '../controllers/AdminController.js';

const router = express.Router();

// ============================================
// AUTH MIDDLEWARE (inline)
// ============================================
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

function requirePermission(permission) {
  return async (req, res, next) => {
    await requireAuth(req, res, async () => {
      if (!req.user?.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
      }
      next();
    });
  };
}

// ============================================
// ROUTES
// ============================================
router.get('/stats', requireAdmin, AdminController.getStats);
router.get('/analytics', requireAdmin, AdminController.getAnalytics);
router.get('/users', requireAdmin, AdminController.getUsers);
router.post('/users/:userId/ban', requirePermission('ban_users'), AdminController.banUser);
router.post('/users/:userId/unban', requirePermission('ban_users'), AdminController.unbanUser);
router.get('/listings/pending', requirePermission('approve_listings'), AdminController.getPendingListings);
router.post('/listings/:listingId/approve', requirePermission('approve_listings'), AdminController.approveListing);
router.post('/listings/:listingId/reject', requirePermission('approve_listings'), AdminController.rejectListing);
router.get('/disputes', requireAdmin, AdminController.getDisputes);
router.post('/disputes/:disputeId/resolve', requireAdmin, AdminController.resolveDispute);

export default router;
