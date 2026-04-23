// services/fileUtils.js
import { supabase } from '../lib/supabase.js';

export async function uploadFile(buffer, path, bucket, contentType = 'application/octet-stream') {
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(path, buffer, {
      contentType,
      cacheControl: '3600',
      upsert: false,
    });
  
  if (error) throw error;
  
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path);
  
  return {
    success: true,
    path,
    publicUrl: urlData.publicUrl,
    data,
  };
}

export async function deleteFile(path, bucket) {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) throw error;
  return { success: true };
}

export async function getSignedUrl(path, bucket, expiresIn = 3600) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expiresIn);
  
  if (error) throw error;
  return { success: true, signedUrl: data.signedUrl };
}

export async function fileExists(path, bucket) {
  const { data, error } = await supabase.storage.from(bucket).list(path.split('/').slice(0, -1).join('/'));
  if (error) return false;
  const fileName = path.split('/').pop();
  return data?.some(file => file.name === fileName) || false;
  } 
