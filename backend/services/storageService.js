// services/storageService.js
import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

export function generateFilePath(userId, filename, assetType = 'assets') {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const extension = filename.split('.').pop();
  return `${assetType}/${userId}/${timestamp}-${random}.${extension}`;
}

export async function uploadFile(file, filePath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) throw error;
    return { success: true, path: filePath, data };
  } catch (error) {
    console.error('Upload file error:', error);
    return { success: false, error: error.message };
  }
}

export function getPublicUrl(filePath, bucket = 'assets') {
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

export async function getSignedUrl(filePath, bucket = 'assets', expiresIn = 3600) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn);

    if (error) throw error;
    return { success: true, url: data.signedUrl };
  } catch (error) {
    console.error('Get signed URL error:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteFile(filePath, bucket = 'assets') {
  try {
    const { error } = await supabase.storage.from(bucket).remove([filePath]);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Delete file error:', error);
    return { success: false, error: error.message };
  }
}
