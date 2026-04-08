// middleware/validateFile.js
import { supabase } from '../lib/supabase.js';

// Allowed file types by category
const ALLOWED_TYPES = {
  images: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic'],
  videos: ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo'],
  audio: ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/aac', 'audio/ogg'],
  documents: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  models: ['model/gltf+json', 'model/gltf-binary', 'application/octet-stream'],
  software: ['application/zip', 'application/x-zip-compressed', 'application/x-msdownload'],
  code: ['text/plain', 'application/json', 'application/javascript', 'text/html', 'text/css'],
};

const ALLOWED_EXTENSIONS = {
  images: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic'],
  videos: ['.mp4', '.mov', '.webm', '.avi'],
  audio: ['.mp3', '.wav', '.flac', '.aac', '.ogg'],
  documents: ['.pdf', '.doc', '.docx'],
  models: ['.gltf', '.glb', '.obj', '.fbx', '.stl'],
  software: ['.zip', '.rar', '.exe', '.msi', '.dmg', '.apk'],
  code: ['.js', '.py', '.html', '.css', '.json', '.sol', '.rs'],
};

const MAX_SIZES = {
  images: 50 * 1024 * 1024,     // 50MB
  videos: 500 * 1024 * 1024,    // 500MB
  audio: 100 * 1024 * 1024,     // 100MB
  documents: 50 * 1024 * 1024,   // 50MB
  models: 200 * 1024 * 1024,     // 200MB
  software: 500 * 1024 * 1024,   // 500MB
  code: 10 * 1024 * 1024,        // 10MB
  default: 10 * 1024 * 1024,     // 10MB
};

// Detect file category from MIME type or extension
export function detectFileCategory(file) {
  const mimeType = file.mimetype || file.type;
  const extension = file.originalname?.substring(file.originalname.lastIndexOf('.')).toLowerCase() || '';

  for (const [category, types] of Object.entries(ALLOWED_TYPES)) {
    if (types.includes(mimeType)) return category;
  }

  for (const [category, extensions] of Object.entries(ALLOWED_EXTENSIONS)) {
    if (extensions.includes(extension)) return category;
  }

  return 'default';
}

// Validate single file
export function validateFile(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const file = req.file;
  const category = detectFileCategory(file);
  const maxSize = MAX_SIZES[category] || MAX_SIZES.default;
  const allowedTypes = ALLOWED_TYPES[category] || [];
  const allowedExtensions = ALLOWED_EXTENSIONS[category] || [];

  const extension = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
  const isValidType = allowedTypes.includes(file.mimetype);
  const isValidExtension = allowedExtensions.includes(extension);

  if (!isValidType && !isValidExtension) {
    return res.status(400).json({
      error: `Invalid file type. Allowed: ${allowedExtensions.join(', ')}`,
      category: category,
    });
  }

  if (file.size > maxSize) {
    return res.status(400).json({
      error: `File too large. Max ${maxSize / 1024 / 1024}MB for ${category}`,
    });
  }

  req.fileCategory = category;
  next();
}

// Validate multiple files
export function validateMultipleFiles(req, res, next) {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  const errors = [];
  for (const file of req.files) {
    const category = detectFileCategory(file);
    const maxSize = MAX_SIZES[category] || MAX_SIZES.default;
    const extension = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
    const allowedExtensions = ALLOWED_EXTENSIONS[category] || [];

    if (!allowedExtensions.includes(extension)) {
      errors.push(`${file.originalname}: Invalid file type`);
    }

    if (file.size > maxSize) {
      errors.push(`${file.originalname}: File too large (max ${maxSize / 1024 / 1024}MB)`);
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  next();
}

// Check if file is blocked (from blocked_files table)
export async function isFileBlocked(fileHash) {
  try {
    const { data, error } = await supabase
      .from('blocked_files')
      .select('*')
      .eq('file_hash', fileHash)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return !!data;
  } catch (error) {
    console.error('Check blocked file error:', error);
    return false;
  }
}

// Get allowed file types list for frontend
export function getAllowedFileTypes() {
  return Object.entries(ALLOWED_EXTENSIONS).map(([category, extensions]) => ({
    category,
    extensions,
    maxSizeMB: MAX_SIZES[category] / 1024 / 1024,
  }));
}
