// models/ForgeAssetModel.js
import { supabase } from '../lib/supabase.js';

export const ForgeAssetModel = {
  // Create new asset
  async create(assetData) {
    const { data, error } = await supabase
      .from('forge_assets')
      .insert({
        creator_id: assetData.creator_id,
        title: assetData.title,
        description: assetData.description,
        category: assetData.category,
        subcategory: assetData.subcategory,
        file_hash: assetData.file_hash,
        file_size: assetData.file_size,
        mime_type: assetData.mime_type,
        storage_path: assetData.storage_path,
        preview_url: assetData.preview_url,
        thumbnail_url: assetData.thumbnail_url,
        license_type: assetData.license_type || 'standard',
        royalty_percentage: assetData.royalty_percentage || 5,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Get asset by ID
  async findById(id) {
    const { data, error } = await supabase
      .from('forge_assets')
      .select(`
        *,
        creator:creator_id(id, username, avatar_url),
        collaborators:forge_collaborators(
          user_id,
          role,
          royalty_split,
          user:users(id, username)
        ),
        versions:forge_versions(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  },

  // Get assets by creator
  async findByCreator(creatorId, options = {}) {
    let query = supabase
      .from('forge_assets')
      .select('*', { count: 'exact' })
      .eq('creator_id', creatorId)
      .order('created_at', { ascending: false });

    if (options.status) {
      query = query.eq('status', options.status);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { assets: data, total: count };
  },

  // Get published assets (marketplace)
  async getPublishedAssets(options = {}) {
    let query = supabase
      .from('forge_assets')
      .select(`
        *,
        creator:creator_id(id, username, avatar_url, vip_tier)
      `)
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (options.category) {
      query = query.eq('category', options.category);
    }
    if (options.search) {
      query = query.ilike('title', `%${options.search}%`);
    }
    if (options.limit) {
      query = query.limit(options.limit);
    }
    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 20) - 1);
    }

    const { data, error, count } = await query;
    if (error) throw error;
    return { assets: data, total: count };
  },

  // Update asset
  async update(id, updates) {
    const { data, error } = await supabase
      .from('forge_assets')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Publish asset
  async publish(id) {
    return this.update(id, {
      status: 'published',
      published_at: new Date().toISOString(),
    });
  },

  // Delete asset (soft delete)
  async delete(id) {
    return this.update(id, { status: 'deleted' });
  },

  // Increment view count
  async incrementViews(id) {
    const { error } = await supabase.rpc('increment_forge_views', { asset_id: id });
    if (error) throw error;
  },

  // Add collaborator
  async addCollaborator(assetId, userId, role, royaltySplit) {
    const { data, error } = await supabase
      .from('forge_collaborators')
      .insert({
        asset_id: assetId,
        user_id: userId,
        role: role || 'contributor',
        royalty_split: royaltySplit || 0,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  },

  // Remove collaborator
  async removeCollaborator(assetId, userId) {
    const { error } = await supabase
      .from('forge_collaborators')
      .delete()
      .eq('asset_id', assetId)
      .eq('user_id', userId);

    if (error) throw error;
  },

  // Create version
  async createVersion(assetId, versionData) {
    // Get current version number
    const { data: asset } = await this.findById(assetId);
    const newVersion = (asset.versions?.length || 0) + 1;

    const { data, error } = await supabase
      .from('forge_versions')
      .insert({
        asset_id: assetId,
        version_number: newVersion,
        file_hash: versionData.file_hash,
        storage_path: versionData.storage_path,
        changelog: versionData.changelog,
      })
      .select()
      .single();

    if (error) throw error;

    // Update main asset with new hash and path
    await this.update(assetId, {
      file_hash: versionData.file_hash,
      storage_path: versionData.storage_path,
    });

    return data;
  },

  // Record sale
  async recordSale(saleData) {
    const { data, error } = await supabase
      .from('forge_sales')
      .insert({
        asset_id: saleData.asset_id,
        buyer_id: saleData.buyer_id,
        seller_id: saleData.seller_id,
        amount: saleData.amount,
        currency: saleData.currency || 'USD',
        royalty_paid: saleData.royalty_paid || 0,
        transaction_id: saleData.transaction_id,
      })
      .select()
      .single();

    if (error) throw error;

    // Increment downloads count
    await supabase.rpc('increment_forge_downloads', { asset_id: saleData.asset_id });

    return data;
  },
};
