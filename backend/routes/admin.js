// routes/admin.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin, requirePermission } from '../middleware/adminAuth.js';
import { AdminController } from '../controllers/AdminController.js';

const router = express.Router();

// All admin routes require authentication + admin role
router.use(requireAuth);
router.use(requireAdmin);

// Dashboard
router.get('/stats', AdminController.getStats);
router.get('/analytics', AdminController.getAnalytics);

// User management
router.get('/users', AdminController.getUsers);
router.post('/users/:userId/ban', requirePermission('ban_users'), AdminController.banUser);
router.post('/users/:userId/unban', requirePermission('ban_users'), AdminController.unbanUser);

// Listing management
router.get('/listings/pending', requirePermission('approve_listings'), AdminController.getPendingListings);
router.post('/listings/:listingId/approve', requirePermission('approve_listings'), AdminController.approveListing);
router.post('/listings/:listingId/reject', requirePermission('approve_listings'), AdminController.rejectListing);

// Dispute management
router.get('/disputes', AdminController.getDisputes);
router.post('/disputes/:disputeId/resolve', AdminController.resolveDispute);

export default router;
