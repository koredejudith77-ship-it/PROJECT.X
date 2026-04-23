// services/storageService.js
import { uploadFile, deleteFile, getSignedUrl, fileExists } from './fileUtils.js';
export { uploadFile as uploadToSupabase, deleteFile as deleteFromStorage, getSignedUrl, fileExists }; 

// Generate unique file path
export function generateFilePath(userId, filename, folder = 'assets') {
  const timestamp = Date.now();
  const random = crypto.randomBytes(8).toString('hex');
  const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
  return `${folder}/${userId}/${timestamp}-${random}-${cleanFilename}`;
}

// Upload file buffer to Supabase Storage
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

// Upload multer file (Express) to Supabase Storage
export async function uploadMulterFile(file, userId, folder = 'assets') {
  try {
    const filePath = generateFilePath(userId, file.originalname, folder);
    const result = await uploadFile(file.buffer, filePath);
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get public URL for a file
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
    console.error('Get signed URL error:', error);
    return { success: false, error: error.message };
  }
}

// Delete file from storage
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

// Check if file exists
export async function fileExists(filePath, bucket = 'assets') {
  try {
    const folderPath = filePath.split('/').slice(0, -1).join('/');
    const fileName = filePath.split('/').pop();
    const { data, error } = await supabase.storage.from(bucket).list(folderPath);
    if (error) throw error;
    return data?.some(file => file.name === fileName) || false;
  } catch (error) {
    return false;
  }
}

// Move file between folders
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
