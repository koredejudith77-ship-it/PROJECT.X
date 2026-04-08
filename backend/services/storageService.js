// services/storageService.js
import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

// Generate unique file path
export function generateFilePath(userId, filename, assetType = 'assets') {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const extension = filename.split('.').pop();
  return `${assetType}/${userId}/${timestamp}-${random}.${extension}`;
}

// Upload file to Supabase Storage
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

// Get public URL for a file
export function getPublicUrl(filePath, bucket = 'assets') {
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

// Generate signed URL (for private files)
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

// Delete file
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

// List files in a folder
export async function listFiles(folderPath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(folderPath);
    if (error) throw error;
    return { success: true, files: data };
  } catch (error) {
    console.error('List files error:', error);
    return { success: false, error: error.message };
  }
}

// Move file between buckets or folders
export async function moveFile(fromPath, toPath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage.from(bucket).move(fromPath, toPath);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Move file error:', error);
    return { success: false, error: error.message };
  }
}

// Copy file
export async function copyFile(fromPath, toPath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage.from(bucket).copy(fromPath, toPath);
    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Copy file error:', error);
    return { success: false, error: error.message };
  }
}
