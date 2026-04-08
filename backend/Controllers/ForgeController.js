// controllers/ForgeController.js
import { ForgeAssetModel } from '../models/ForgeAssetModel.js';
import { storageService } from '../services/storageService.js';
import { hashService } from '../services/hashService.js';
import { validateFile, detectFileCategory } from '../middleware/validateFile.js';

export const ForgeController = {
  // Upload new asset
  async uploadAsset(req, res) {
    try {
      const { title, description, category, subcategory, license_type, royalty_percentage } = req.body;
      const file = req.file;
      const userId = req.user.id;

      if (!file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Generate file hash
      const fileBuffer = file.buffer;
      const fileHash = hashService.generateHash(fileBuffer);

      // Generate storage path
      const filePath = storageService.generateFilePath(userId, file.originalname, 'forge-assets');

      // Upload to storage
      const uploadResult = await storageService.uploadFile(file, filePath, 'forge-assets');
      if (!uploadResult.success) {
        return res.status(500).json({ error: 'Upload failed' });
      }

      // Create asset record
      const asset = await ForgeAssetModel.create({
        creator_id: userId,
        title,
        description,
        category,
        subcategory,
        file_hash: fileHash,
        file_size: file.size,
        mime_type: file.mimetype,
        storage_path: filePath,
        license_type,
        royalty_percentage: royalty_percentage ? parseFloat(royalty_percentage) : 5,
      });

      res.json({ success: true, asset });
    } catch (error) {
      console.error('Upload asset error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get asset by ID
  async getAsset(req, res) {
    try {
      const { id } = req.params;
      const asset = await ForgeAssetModel.findById(id);

      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }

      // Increment view count
      await ForgeAssetModel.incrementViews(id);

      res.json({ asset });
    } catch (error) {
      console.error('Get asset error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get user's assets
  async getUserAssets(req, res) {
    try {
      const userId = req.user.id;
      const { status, limit = 20, page = 1 } = req.query;
      const offset = (page - 1) * limit;

      const result = await ForgeAssetModel.findByCreator(userId, {
        status,
        limit: parseInt(limit),
        offset,
      });

      res.json({
        assets: result.assets,
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(result.total / limit),
      });
    } catch (error) {
      console.error('Get user assets error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Get marketplace assets
  async getMarketplace(req, res) {
    try {
      const { category, search, limit = 20, page = 1 } = req.query;
      const offset = (page - 1) * limit;

      const result = await ForgeAssetModel.getPublishedAssets({
        category,
        search,
        limit: parseInt(limit),
        offset,
      });

      res.json({
        assets: result.assets,
        total: result.total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(result.total / limit),
      });
    } catch (error) {
      console.error('Get marketplace error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Update asset
  async updateAsset(req, res) {
    try {
      const { id } = req.params;
      const { title, description, category, subcategory, license_type, royalty_percentage } = req.body;

      // Check ownership
      const asset = await ForgeAssetModel.findById(id);
      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      if (asset.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your asset' });
      }

      const updated = await ForgeAssetModel.update(id, {
        title,
        description,
        category,
        subcategory,
        license_type,
        royalty_percentage,
      });

      res.json({ success: true, asset: updated });
    } catch (error) {
      console.error('Update asset error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Publish asset
  async publishAsset(req, res) {
    try {
      const { id } = req.params;

      const asset = await ForgeAssetModel.findById(id);
      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      if (asset.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your asset' });
      }

      const published = await ForgeAssetModel.publish(id);
      res.json({ success: true, asset: published });
    } catch (error) {
      console.error('Publish asset error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Delete asset
  async deleteAsset(req, res) {
    try {
      const { id } = req.params;

      const asset = await ForgeAssetModel.findById(id);
      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      if (asset.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Not your asset' });
      }

      await ForgeAssetModel.delete(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Delete asset error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Add collaborator
  async addCollaborator(req, res) {
    try {
      const { id } = req.params;
      const { user_id, role, royalty_split } = req.body;

      const asset = await ForgeAssetModel.findById(id);
      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      if (asset.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Only creator can add collaborators' });
      }

      const collaborator = await ForgeAssetModel.addCollaborator(id, user_id, role, royalty_split);
      res.json({ success: true, collaborator });
    } catch (error) {
      console.error('Add collaborator error:', error);
      res.status(500).json({ error: error.message });
    }
  },

  // Remove collaborator
  async removeCollaborator(req, res) {
    try {
      const { id, userId } = req.params;

      const asset = await ForgeAssetModel.findById(id);
      if (!asset) {
        return res.status(404).json({ error: 'Asset not found' });
      }
      if (asset.creator_id !== req.user.id) {
        return res.status(403).json({ error: 'Only creator can remove collaborators' });
      }

      await ForgeAssetModel.removeCollaborator(id, userId);
      res.json({ success: true });
    } catch (error) {
      console.error('Remove collaborator error:', error);
      res.status(500).json({ error: error.message });
    }
  },
};
