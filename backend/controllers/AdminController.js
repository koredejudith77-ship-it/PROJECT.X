// controllers/AdminController.js
import { supabase } from '../lib/supabase.js';

export const AdminController = {
  // Get platform stats
  async getStats(req, res) {
    try {
      const [usersCount, listingsCount, transactionsCount, disputesCount] = await Promise.all([
        supabase.from('users').select('*', { count: 'exact', head: true }),
        supabase.from('listings').select('*', { count: 'exact', head: true }),
        supabase.from('transactions').select('*', { count: 'exact', head: true }),
        supabase.from('disputes').select('*', { count: 'exact', head: true }).eq('status', 'open'),
      ]);

      const { data: revenue } = await supabase
        .from('transactions')
        .select('platform_fee')
        .eq('escrow_status', 'released');

      const totalRevenue = revenue?.reduce((sum, t) => sum + (t.platform_fee || 0), 0) || 0;

      res.json({
        totalUsers: usersCount.count || 0,
        totalListings: listingsCount.count || 0,
        totalTransactions: transactionsCount.count || 0,
        openDisputes: disputesCount.count || 0,
        totalRevenue,
      });
    } catch (error) {
      console.error('Get stats error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get all users (with filters)
  async getUsers(req, res) {
    try {
      const { page = 1, limit = 20, search, is_banned } = req.query;
      const offset = (page - 1) * limit;

      let query = supabase.from('users').select('*', { count: 'exact' });

      if (search) {
        query = query.or(`username.ilike.%${search}%,email.ilike.%${search}%`);
      }
      if (is_banned !== undefined) {
        query = query.eq('is_banned', is_banned === 'true');
      }

      const { data, error, count } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) throw error;

      res.json({
        users: data,
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil((count || 0) / limit),
      });
    } catch (error) {
      console.error('Get users error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Ban user
  async banUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason } = req.body;

      const { error } = await supabase
        .from('users')
        .update({ is_banned: true, banned_at: new Date().toISOString(), ban_reason: reason })
        .eq('id', userId);

      if (error) throw error;

      // Log admin action
      await supabase.from('audit_logs').insert({
        user_id: req.user.id,
        action: 'user_banned',
        entity_type: 'user',
        entity_id: userId,
        new_values: { reason },
      });

      res.json({ success: true, message: 'User banned successfully' });
    } catch (error) {
      console.error('Ban user error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Unban user
  async unbanUser(req, res) {
    try {
      const { userId } = req.params;

      const { error } = await supabase
        .from('users')
        .update({ is_banned: false, banned_at: null, ban_reason: null })
        .eq('id', userId);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        user_id: req.user.id,
        action: 'user_unbanned',
        entity_type: 'user',
        entity_id: userId,
      });

      res.json({ success: true, message: 'User unbanned successfully' });
    } catch (error) {
      console.error('Unban user error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get pending listings
  async getPendingListings(req, res) {
    try {
      const { data, error } = await supabase
        .from('listings')
        .select(`
          *,
          seller:users!seller_id(id, username, email, is_verified)
        `)
        .eq('status', 'pending_review')
        .order('created_at', { ascending: true });

      if (error) throw error;
      res.json({ listings: data });
    } catch (error) {
      console.error('Get pending listings error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Approve listing
  async approveListing(req, res) {
    try {
      const { listingId } = req.params;

      const { error } = await supabase
        .from('listings')
        .update({ 
          status: 'approved', 
          approved_at: new Date().toISOString(),
          approved_by: req.user.id,
          is_verified: true,
        })
        .eq('id', listingId);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        user_id: req.user.id,
        action: 'listing_approved',
        entity_type: 'listing',
        entity_id: listingId,
      });

      res.json({ success: true, message: 'Listing approved' });
    } catch (error) {
      console.error('Approve listing error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Reject listing
  async rejectListing(req, res) {
    try {
      const { listingId } = req.params;
      const { reason } = req.body;

      const { error } = await supabase
        .from('listings')
        .update({ status: 'rejected' })
        .eq('id', listingId);

      if (error) throw error;

      await supabase.from('audit_logs').insert({
        user_id: req.user.id,
        action: 'listing_rejected',
        entity_type: 'listing',
        entity_id: listingId,
        new_values: { reason },
      });

      res.json({ success: true, message: 'Listing rejected' });
    } catch (error) {
      console.error('Reject listing error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get all disputes
  async getDisputes(req, res) {
    try {
      const { data, error } = await supabase
        .from('disputes')
        .select(`
          *,
          transaction:transactions(*),
          raised_by_user:users!raised_by(id, username, email)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      res.json({ disputes: data });
    } catch (error) {
      console.error('Get disputes error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Resolve dispute
  async resolveDispute(req, res) {
    try {
      const { disputeId } = req.params;
      const { resolution, notes, refund_amount } = req.body;

      const { error } = await supabase
        .from('disputes')
        .update({ 
          status: 'resolved', 
          resolved_at: new Date().toISOString(),
          resolved_by: req.user.id,
          admin_notes: notes,
        })
        .eq('id', disputeId);

      if (error) throw error;

      // If refund needed, process it
      if (refund_amount && refund_amount > 0) {
        // Call Stripe refund logic here
        console.log(`Refund ${refund_amount} processed for dispute ${disputeId}`);
      }

      await supabase.from('audit_logs').insert({
        user_id: req.user.id,
        action: 'dispute_resolved',
        entity_type: 'dispute',
        entity_id: disputeId,
        new_values: { resolution, notes, refund_amount },
      });

      res.json({ success: true, message: 'Dispute resolved' });
    } catch (error) {
      console.error('Resolve dispute error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get platform analytics
  async getAnalytics(req, res) {
    try {
      const { days = 7 } = req.query;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      // Daily revenue
      const { data: revenueData } = await supabase
        .from('transactions')
        .select('platform_fee, created_at')
        .gte('created_at', startDate.toISOString())
        .eq('escrow_status', 'released');

      // Daily signups
      const { data: signupData } = await supabase
        .from('users')
        .select('created_at')
        .gte('created_at', startDate.toISOString());

      // Aggregate by day
      const revenueByDay = {};
      revenueData?.forEach(t => {
        const day = t.created_at.split('T')[0];
        revenueByDay[day] = (revenueByDay[day] || 0) + (t.platform_fee || 0);
      });

      const signupsByDay = {};
      signupData?.forEach(u => {
        const day = u.created_at.split('T')[0];
        signupsByDay[day] = (signupsByDay[day] || 0) + 1;
      });

      res.json({
        revenue: Object.entries(revenueByDay).map(([date, amount]) => ({ date, amount })),
        signups: Object.entries(signupsByDay).map(([date, count]) => ({ date, count })),
      });
    } catch (error) {
      console.error('Get analytics error:', error);
      res.status(500).json({ error: error.message });
    }
  },
};
