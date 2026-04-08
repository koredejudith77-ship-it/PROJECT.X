// services/watermarkService.js
import sharp from 'sharp';
import { storageService } from './storageService.js';

export const WatermarkService = {
  // Add text watermark to image
  async addTextWatermark(imageBuffer, text = 'BUILD.X', position = 'southeast') {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const width = metadata.width;
      const height = metadata.height;

      // Calculate watermark position
      let left, top;
      const padding = 20;
      const textSize = Math.floor(Math.min(width, height) * 0.05);

      switch (position) {
        case 'northwest':
          left = padding;
          top = padding;
          break;
        case 'northeast':
          left = width - padding - (text.length * textSize * 0.6);
          top = padding;
          break;
        case 'southwest':
          left = padding;
          top = height - padding - textSize;
          break;
        case 'southeast':
        default:
          left = width - padding - (text.length * textSize * 0.6);
          top = height - padding - textSize;
          break;
      }

      // Create SVG overlay with text
      const svg = `
        <svg width="${width}" height="${height}">
          <text
            x="${left}"
            y="${top}"
            font-family="Arial, sans-serif"
            font-size="${textSize}"
            fill="rgba(212, 175, 55, 0.6)"
            font-weight="bold"
          >${text}</text>
        </svg>
      `;

      const watermarkedBuffer = await sharp(imageBuffer)
        .composite([{ input: Buffer.from(svg), blend: 'over' }])
        .toBuffer();

      return { success: true, watermarkedBuffer };
    } catch (error) {
      console.error('Add text watermark error:', error);
      return { success: false, error: error.message };
    }
  },

  // Add image watermark (logo)
  async addImageWatermark(imageBuffer, logoBuffer, position = 'southeast', opacity = 0.5) {
    try {
      const metadata = await sharp(imageBuffer).metadata();
      const logoMetadata = await sharp(logoBuffer).metadata();

      const logoWidth = Math.min(logoMetadata.width, metadata.width * 0.15);
      const logoHeight = Math.round(logoWidth * (logoMetadata.height / logoMetadata.width));

      const resizedLogo = await sharp(logoBuffer)
        .resize(logoWidth, logoHeight)
        .toBuffer();

      let left, top;
      const padding = 20;

      switch (position) {
        case 'northwest':
          left = padding;
          top = padding;
          break;
        case 'northeast':
          left = metadata.width - logoWidth - padding;
          top = padding;
          break;
        case 'southwest':
          left = padding;
          top = metadata.height - logoHeight - padding;
          break;
        case 'southeast':
        default:
          left = metadata.width - logoWidth - padding;
          top = metadata.height - logoHeight - padding;
          break;
      }

      const watermarkedBuffer = await sharp(imageBuffer)
        .composite([{ input: resizedLogo, left, top, blend: 'over' }])
        .toBuffer();

      return { success: true, watermarkedBuffer };
    } catch (error) {
      console.error('Add image watermark error:', error);
      return { success: false, error: error.message };
    }
  },

  // Add watermark and save to storage
  async watermarkAndSave(imageBuffer, assetId, originalPath) {
    try {
      // Add text watermark
      const result = await this.addTextWatermark(imageBuffer, 'BUILD.X', 'southeast');
      
      if (!result.success) {
        return result;
      }

      // Generate watermarked file path
      const watermarkedPath = originalPath.replace(/\.([^/.]+)$/, '_watermarked.$1');
      
      // Upload watermarked version
      const uploadResult = await storageService.uploadFile(
        result.watermarkedBuffer,
        watermarkedPath,
        'forge-assets'
      );

      if (!uploadResult.success) {
        return uploadResult;
      }

      // Update asset with watermarked path
      await supabase
        .from('forge_assets')
        .update({ 
          is_watermarked: true,
          watermarked_path: watermarkedPath,
        })
        .eq('id', assetId);

      return { success: true, watermarkedPath };
    } catch (error) {
      console.error('Watermark and save error:', error);
      return { success: false, error: error.message };
    }
  },

  // Remove watermark (for original asset download after purchase)
  async getOriginalUrl(assetId) {
    try {
      const { data: asset, error } = await supabase
        .from('forge_assets')
        .select('storage_path')
        .eq('id', assetId)
        .single();

      if (error) throw error;

      // Generate signed URL for original (non-watermarked) asset
      const signedUrl = await storageService.getSignedUrl(asset.storage_path, 'forge-assets', 3600);
      
      return signedUrl;
    } catch (error) {
      console.error('Get original URL error:', error);
      return { success: false, error: error.message };
    }
  },
};
