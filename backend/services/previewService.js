// services/previewService.js
import sharp from 'sharp';
import { supabase } from '../lib/supabase.js';
import { uploadFile } from './fileUtils.js';

// Use uploadFile instead of direct supabase.storage.upload
export const PreviewService = {
  // Generate image previews (multiple sizes)
  async generateImagePreviews(imageBuffer, assetId) {
    try {
      const sizes = [
        { name: 'thumbnail', width: 150, height: 150 },
        { name: 'small', width: 300, height: 300 },
        { name: 'medium', width: 600, height: 600 },
        { name: 'large', width: 1200, height: 1200 },
      ];

      const previews = {};

      for (const size of sizes) {
        const resizedBuffer = await sharp(imageBuffer)
          .resize(size.width, size.height, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        const filePath = `previews/${assetId}/${size.name}.jpg`;
        const uploadResult = await storageService.uploadFile(resizedBuffer, filePath, 'previews');

        if (uploadResult.success) {
          previews[size.name] = storageService.getPublicUrl(filePath, 'previews');
        }
      }

      // Save preview URLs to database
      await supabase
        .from('forge_assets')
        .update({
          thumbnail_url: previews.thumbnail,
          preview_url: previews.medium,
        })
        .eq('id', assetId);

      return { success: true, previews };
    } catch (error) {
      console.error('Generate image previews error:', error);
      return { success: false, error: error.message };
    }
  },

  // Generate video thumbnail (first frame)
  async generateVideoThumbnail(videoBuffer, assetId) {
    try {
      // Note: This requires ffmpeg on the server
      // For Render, you may need to install ffmpeg or use a service like Mux
      
      // Placeholder implementation – in production, use ffmpeg or external service
      console.log('Video thumbnail generation requires ffmpeg');
      
      return { success: false, error: 'Video thumbnail generation not configured' };
    } catch (error) {
      console.error('Generate video thumbnail error:', error);
      return { success: false, error: error.message };
    }
  },

  // Generate audio waveform preview
  async generateAudioWaveform(audioBuffer, assetId) {
    try {
      // This would require audio processing library
      // Return placeholder waveform data
      const waveform = Array(100).fill(0).map(() => Math.random() * 100);
      
      await supabase
        .from('forge_assets')
        .update({ waveform_data: waveform })
        .eq('id', assetId);

      return { success: true, waveform };
    } catch (error) {
      console.error('Generate audio waveform error:', error);
      return { success: false, error: error.message };
    }
  },

  // Generate PDF preview (first page as image)
  async generatePdfPreview(pdfBuffer, assetId) {
    try {
      // This would require pdf2img or similar library
      console.log('PDF preview generation requires additional libraries');
      
      return { success: false, error: 'PDF preview not configured' };
    } catch (error) {
      console.error('Generate PDF preview error:', error);
      return { success: false, error: error.message };
    }
  },

  // Auto-detect file type and generate appropriate preview
  async generatePreview(fileBuffer, mimeType, assetId) {
    if (mimeType.startsWith('image/')) {
      return await this.generateImagePreviews(fileBuffer, assetId);
    } else if (mimeType.startsWith('video/')) {
      return await this.generateVideoThumbnail(fileBuffer, assetId);
    } else if (mimeType.startsWith('audio/')) {
      return await this.generateAudioWaveform(fileBuffer, assetId);
    } else if (mimeType === 'application/pdf') {
      return await this.generatePdfPreview(fileBuffer, assetId);
    }
    
    return { success: true, previews: {} };
  },
};
