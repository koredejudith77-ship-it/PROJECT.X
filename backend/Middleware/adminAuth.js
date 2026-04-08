// middleware/adminAuth.js
import { supabase } from '../lib/supabase.js';

export async function requireAdmin(req, res, next) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('is_admin, admin_role')
      .eq('id', userId)
      .single();

    if (error || !user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    req.adminRole = user.admin_role || 'moderator';
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Check specific admin permissions
export function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      const userId = req.user?.id;
      const { data: user } = await supabase
        .from('users')
        .select('admin_role')
        .eq('id', userId)
        .single();

      const permissions = {
        super_admin: ['all'],
        moderator: ['ban_users', 'view_reports', 'moderate_chat'],
        verifier: ['approve_listings', 'verify_assets'],
        host: ['manage_sessions', 'view_listings'],
      };

      const userPerms = permissions[user?.admin_role] || [];
      
      if (!userPerms.includes('all') && !userPerms.includes(permission)) {
        return res.status(403).json({ error: `Permission denied: ${permission} required` });
      }

      next();
    } catch (error) {
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
