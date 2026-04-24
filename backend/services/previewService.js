import sharp from 'sharp';
import { supabase } from '../lib/supabase.js';
import { uploadFile, getSignedUrl } from './fileUtils.js';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import { fromBuffer } from 'pdf2pic';
import audiowaveform from 'audiowaveform';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

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
        
        const uploadResult = await uploadFile(
          resizedBuffer,
          filePath,
          'previews',
          'image/jpeg'
        );

        if (uploadResult.success) {
          previews[size.name] = uploadResult.publicUrl;
        }
      }

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
    const tempVideoPath = join(tmpdir(), `${randomUUID()}.mp4`);
    const tempThumbnailPath = join(tmpdir(), `${randomUUID()}.jpg`);
    
    try {
      // Write video buffer to temp file
      await writeFile(tempVideoPath, videoBuffer);

      // Extract first frame at 1 second mark
      await new Promise((resolve, reject) => {
        ffmpeg(tempVideoPath)
          .screenshots({
            timestamps: ['1'],
            filename: `${randomUUID()}.jpg`,
            folder: tmpdir(),
            size: '600x?',
          })
          .on('end', resolve)
          .on('error', reject);
      });

      // Get the generated thumbnail
      const files = await readdir(tmpdir());
      const thumbnailFile = files.find(f => f.startsWith('tn_'));
      
      if (!thumbnailFile) {
        throw new Error('Thumbnail generation failed - no output file');
      }

      const thumbnailPath = join(tmpdir(), thumbnailFile);
      const thumbnailBuffer = await readFile(thumbnailPath);

      // Upload thumbnail
      const filePath = `previews/${assetId}/video-thumbnail.jpg`;
      const uploadResult = await uploadFile(
        thumbnailBuffer,
        filePath,
        'previews',
        'image/jpeg'
      );

      if (!uploadResult.success) {
        throw new Error('Failed to upload thumbnail');
      }

      // Get video metadata
      const metadata = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempVideoPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata);
        });
      });

      const duration = Math.round(metadata.format.duration || 0);
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      const resolution = videoStream 
        ? `${videoStream.width}x${videoStream.height}` 
        : 'unknown';

      // Update database
      await supabase
        .from('forge_assets')
        .update({
          thumbnail_url: uploadResult.publicUrl,
          preview_url: uploadResult.publicUrl,
          metadata: {
            duration,
            resolution,
            codec: videoStream?.codec_name,
            bitrate: metadata.format.bit_rate,
          },
        })
        .eq('id', assetId);

      return { 
        success: true, 
        thumbnailUrl: uploadResult.publicUrl,
        duration,
        resolution,
      };
    } catch (error) {
      console.error('Generate video thumbnail error:', error);
      
      // Fallback: create a placeholder thumbnail
      try {
        const placeholderBuffer = await sharp({
          create: {
            width: 600,
            height: 400,
            channels: 3,
            background: { r: 30, g: 30, b: 30 },
          },
        })
          .jpeg()
          .toBuffer();

        const filePath = `previews/${assetId}/video-placeholder.jpg`;
        const uploadResult = await uploadFile(
          placeholderBuffer,
          filePath,
          'previews',
          'image/jpeg'
        );

        if (uploadResult.success) {
          await supabase
            .from('forge_assets')
            .update({ thumbnail_url: uploadResult.publicUrl })
            .eq('id', assetId);
        }
      } catch (placeholderError) {
        console.error('Failed to create video placeholder:', placeholderError);
      }

      return { success: false, error: error.message, placeholder: true };
    } finally {
      // Cleanup temp files
      await unlink(tempVideoPath).catch(() => {});
      try {
        const files = await readdir(tmpdir());
        for (const file of files) {
          if (file.startsWith('tn_')) {
            await unlink(join(tmpdir(), file)).catch(() => {});
          }
        }
      } catch {}
    }
  },

  // Generate audio waveform preview
  async generateAudioWaveform(audioBuffer, assetId) {
    const tempAudioPath = join(tmpdir(), `${randomUUID()}.mp3`);
    
    try {
      // Write audio buffer to temp file
      await writeFile(tempAudioPath, audioBuffer);

      // Generate waveform data
      const waveform = await new Promise((resolve, reject) => {
        audiowaveform(tempAudioPath, {
          pixelsPerSecond: 20,
          bits: 8,
          outputFormat: 'json',
        }, (err, waveform) => {
          if (err) reject(err);
          else resolve(waveform);
        });
      });

      // Generate waveform image
      const waveformImagePath = join(tmpdir(), `${randomUUID()}.png`);
      await new Promise((resolve, reject) => {
        audiowaveform(tempAudioPath, {
          outputFilename: waveformImagePath,
          width: 1200,
          height: 200,
          colors: {
            background: 'FFFFFF00',
            waveform: 'D4AF37',
            axis: 'FFFFFF',
          },
        }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Upload waveform image
      const imageBuffer = await readFile(waveformImagePath);
      const imagePath = `previews/${assetId}/waveform.png`;
      const imageUpload = await uploadFile(
        imageBuffer,
        imagePath,
        'previews',
        'image/png'
      );

      // Get audio metadata
      const metadata = await new Promise((resolve, reject) => {
        ffmpeg.ffprobe(tempAudioPath, (err, metadata) => {
          if (err) reject(err);
          else resolve(metadata);
        });
      });

      const duration = Math.round(metadata.format.duration || 0);
      const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

      // Update database
      await supabase
        .from('forge_assets')
        .update({
          waveform_data: waveform,
          preview_url: imageUpload.publicUrl || null,
          metadata: {
            duration,
            sampleRate: audioStream?.sample_rate,
            channels: audioStream?.channels,
            codec: audioStream?.codec_name,
            bitrate: metadata.format.bit_rate,
          },
        })
        .eq('id', assetId);

      return { 
        success: true, 
        waveform,
        previewUrl: imageUpload.publicUrl,
        duration,
      };
    } catch (error) {
      console.error('Generate audio waveform error:', error);
      
      // Fallback: random waveform data
      const waveform = Array(100).fill(0).map(() => Math.random() * 100);
      
      await supabase
        .from('forge_assets')
        .update({ waveform_data: waveform })
        .eq('id', assetId);

      return { success: false, error: error.message, placeholderData: waveform };
    } finally {
      // Cleanup temp files
      await unlink(tempAudioPath).catch(() => {});
      try {
        const files = await readdir(tmpdir());
        for (const file of files) {
          if (file.endsWith('.png') && file.includes(assetId)) {
            await unlink(join(tmpdir(), file)).catch(() => {});
          }
        }
      } catch {}
    }
  },

  // Generate PDF preview (first page as image)
  async generatePdfPreview(pdfBuffer, assetId) {
    try {
      // Convert first page to image
      const options = {
        density: 150,          // DPI
        format: 'jpg',
        width: 1200,
        height: 1600,
        quality: 80,
      };

      const convert = fromBuffer(pdfBuffer, options);
      const firstPage = await convert(1, { responseType: 'buffer' });
      
      if (!firstPage || !firstPage.buffer) {
        throw new Error('Failed to convert PDF page');
      }

      // Generate thumbnail (smaller version)
      const thumbnailBuffer = await sharp(firstPage.buffer)
        .resize(300, 400, { fit: 'inside' })
        .jpeg({ quality: 70 })
        .toBuffer();

      // Upload preview (full size first page)
      const previewPath = `previews/${assetId}/pdf-preview.jpg`;
      const previewUpload = await uploadFile(
        firstPage.buffer,
        previewPath,
        'previews',
        'image/jpeg'
      );

      // Upload thumbnail
      const thumbnailPath = `previews/${assetId}/pdf-thumbnail.jpg`;
      const thumbnailUpload = await uploadFile(
        thumbnailBuffer,
        thumbnailPath,
        'previews',
        'image/jpeg'
      );

      // Count pages (approximate)
      const pdfParse = await import('pdf-parse');
      const pdfData = await pdfParse.default(pdfBuffer);
      const pageCount = pdfData.numpages;

      // Update database
      await supabase
        .from('forge_assets')
        .update({
          thumbnail_url: thumbnailUpload.publicUrl || previewUpload.publicUrl,
          preview_url: previewUpload.publicUrl,
          metadata: {
            pages: pageCount,
            title: pdfData.info?.Title,
            author: pdfData.info?.Author,
          },
        })
        .eq('id', assetId);

      return { 
        success: true, 
        previewUrl: previewUpload.publicUrl,
        thumbnailUrl: thumbnailUpload.publicUrl,
        pages: pageCount,
      };
    } catch (error) {
      console.error('Generate PDF preview error:', error);
      
      // Fallback: generate a simple cover image with PDF info
      try {
        const pdfParse = await import('pdf-parse');
        const pdfData = await pdfParse.default(pdfBuffer);
        
        const svgCover = `
          <svg width="600" height="800">
            <rect width="100%" height="100%" fill="#1a1a1a"/>
            <rect x="20" y="20" width="560" height="760" fill="none" stroke="#d4af37" stroke-width="2"/>
            <text x="300" y="300" text-anchor="middle" fill="#d4af37" font-size="48" font-family="Arial">PDF</text>
            <text x="300" y="400" text-anchor="middle" fill="#ffffff" font-size="24" font-family="Arial">
              ${pdfData.numpages || '?'} Pages
            </text>
            <text x="300" y="500" text-anchor="middle" fill="#999999" font-size="16" font-family="Arial">
              ${pdfData.info?.Title || 'Untitled'}
            </text>
          </svg>
        `;

        const coverBuffer = await sharp(Buffer.from(svgCover))
          .jpeg({ quality: 80 })
          .toBuffer();

        const filePath = `previews/${assetId}/pdf-cover.jpg`;
        const uploadResult = await uploadFile(
          coverBuffer,
          filePath,
          'previews',
          'image/jpeg'
        );

        if (uploadResult.success) {
          await supabase
            .from('forge_assets')
            .update({
              thumbnail_url: uploadResult.publicUrl,
              preview_url: uploadResult.publicUrl,
              metadata: { pages: pdfData.numpages },
            })
            .eq('id', assetId);
        }
      } catch (fallbackError) {
        console.error('PDF fallback preview failed:', fallbackError);
      }

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

  // Get preview URL
  async getPreviewUrl(assetId, size = 'medium') {
    try {
      const { data: asset, error } = await supabase
        .from('forge_assets')
        .select('preview_url, thumbnail_url')
        .eq('id', assetId)
        .single();
      
      if (error) throw error;
      
      const url = size === 'thumbnail' ? asset.thumbnail_url : asset.preview_url;
      return { success: true, url };
    } catch (error) {
      console.error('Get preview URL error:', error);
      return { success: false, error: error.message };
    }
  }
};

export default PreviewService; 
