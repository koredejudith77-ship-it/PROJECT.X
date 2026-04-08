// services/storageService.js
import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

// Generate unique file path
export function generateFilePath(userId, filename, folder = 'assets') {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${folder}/${userId}/${timestamp}-${random}-${cleanFilename}`;
}

// Upload file to Supabase Storage
export async function uploadFile(fileBuffer, filePath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(filePath, fileBuffer, {
        cacheControl: '3600',
        contentType: 'application/octet-stream',
        upsert: false,
      });

    if (error) throw error;
    return { success: true, path: filePath, data };
  } catch (error) {
    console.error('Upload file error:', error);
    return { success: false, error: error.message };
  }
}

// Upload file from Express multer
export async function uploadMulterFile(file, userId, folder = 'assets') {
  try {
    const filePath = generateFilePath(userId, file.originalname, folder);
    const result = await uploadFile(file.buffer, filePath);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get public URL
export function getPublicUrl(filePath, bucket = 'assets') {
  const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
  return data.publicUrl;
}

// Get signed URL (for private files)
export async function getSignedUrl(filePath, bucket = 'assets', expiresIn = 3600) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(filePath, expiresIn);

    if (error) throw error;
    return { success: true, url: data.signedUrl };
  } catch (error) {
    console.error('Signed URL error:', error);
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

// Check if file exists
export async function fileExists(filePath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(filePath.split('/').slice(0, -1).join('/'));
    if (error) throw error;
    const fileName = filePath.split('/').pop();
    return data?.some(file => file.name === fileName) || false;
  } catch (error) {
    return false;
  }
}

// Get file info
export async function getFileInfo(filePath, bucket = 'assets') {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(filePath.split('/').slice(0, -1).join('/'));
    if (error) throw error;
    const fileName = filePath.split('/').pop();
    const file = data?.find(f => f.name === fileName);
    return file || null;
  } catch (error) {
    return null;
  }
      } 
