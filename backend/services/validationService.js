// services/validationService.js
import { supabase } from '../lib/supabase.js';
import { generateHash } from './hashService.js';

// File type detection using magic numbers
const MAGIC_NUMBERS = {
  '89504e47': 'image/png',
  'ffd8ffe0': 'image/jpeg',
  'ffd8ffe1': 'image/jpeg',
  'ffd8ffe2': 'image/jpeg',
  '25504446': 'application/pdf',
  '504b0304': 'application/zip',
  '1f8b08': 'application/gzip',
  '66747970': 'video/mp4',
  '52494646': 'video/webm',
  '494433': 'audio/mpeg',
  '664c6143': 'audio/flac',
};

// Define limits for file size checking
const FILE_LIMITS = {
  image: 50 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  model: 200 * 1024 * 1024,
  software: 500 * 1024 * 1024,
  default: 10 * 1024 * 1024,
};

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic',
  '.mp4', '.mov', '.webm', '.avi',
  '.mp3', '.wav', '.flac', '.aac', '.ogg',
  '.pdf', '.doc', '.docx',
  '.gltf', '.glb', '.obj', '.fbx', '.stl',
  '.zip', '.rar',
  '.js', '.py', '.html', '.css', '.json', '.sol',
];

export const ValidationService = {
  // Validate file type by magic number (not just extension)
  detectRealFileType(buffer) {
    const hex = buffer.toString('hex', 0, 8).toLowerCase();
    
    for (const [magic, type] of Object.entries(MAGIC_NUMBERS)) {
      if (hex.startsWith(magic)) {
        return type;
      }
    }
    return 'application/octet-stream';
  },

  // Validate file integrity (try to parse/read)
  async validateFileIntegrity(file, detectedType) {
    try {
      if (detectedType.startsWith('image/')) {
        const sharp = await import('sharp');
        await sharp(file.buffer).metadata();
      } else if (detectedType === 'application/pdf') {
        const pdf = await import('pdf-parse');
        await pdf(file.buffer);
      } else if (detectedType.startsWith('video/')) {
        const buffer = file.buffer;
        const hasMoov = buffer.toString('hex', 4, 8).includes('6d6f6f76');
        if (!hasMoov) {
          return { valid: false, error: 'Video file appears corrupted (missing moov atom)' };
        }
      }
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `File appears corrupted: ${error.message}` };
    }
  },

  // Check if file hash is blocked
  async isHashBlocked(fileHash) {
    try {
      const { data, error } = await supabase
        .from('blocked_files')
        .select('*')
        .eq('file_hash', fileHash)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return { isBlocked: !!data, reason: data?.reason };
    } catch (error) {
      console.error('Check blocked hash error:', error);
      return { isBlocked: false };
    }
  },

  // Validate file size against category
  validateFileSize(fileSize, category) {
    const limit = FILE_LIMITS[category] || FILE_LIMITS.default;
    const isValid = fileSize <= limit;
    
    return {
      valid: isValid,
      maxSizeMB: Math.round(limit / 1024 / 1024),
      actualSizeMB: Math.round(fileSize / 1024 / 1024),
    };
  },

  // Validate filename (prevent path traversal)
  validateFilename(filename) {
    const dangerous = ['..', '/', '\\', '%00', '%2e', '%2f'];
    for (const char of dangerous) {
      if (filename.includes(char)) {
        return { valid: false, error: 'Invalid filename contains dangerous characters' };
      }
    }
    
    const ext = filename.substring(filename.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return { valid: false, error: `File extension ${ext} is not allowed` };
    }
    
    return { valid: true };
  },

  // Complete file validation
  async validateFile(file, category) {
    const errors = [];
    
    const filenameCheck = this.validateFilename(file.originalname);
    if (!filenameCheck.valid) {
      errors.push(filenameCheck.error);
    }
    
    const sizeCheck = this.validateFileSize(file.size, category);
    if (!sizeCheck.valid) {
      errors.push(`File too large. Max ${sizeCheck.maxSizeMB}MB, got ${sizeCheck.actualSizeMB}MB`);
    }
    
    const detectedType = this.detectRealFileType(file.buffer);
    const claimedType = file.mimetype;
    
    if (detectedType !== 'application/octet-stream' && detectedType !== claimedType) {
      errors.push(`File type mismatch. Claimed: ${claimedType}, Detected: ${detectedType}`);
    }
    
    const integrityCheck = await this.validateFileIntegrity(file, detectedType);
    if (!integrityCheck.valid) {
      errors.push(integrityCheck.error);
    }
    
    const fileHash = generateHash(file.buffer);
    const blockedCheck = await this.isHashBlocked(fileHash);
    if (blockedCheck.isBlocked) {
      errors.push(`This file has been blocked: ${blockedCheck.reason || 'Security violation'}`);
    }
    
    return {
      valid: errors.length === 0,
      errors,
      detectedType,
      fileHash,
      fileSize: file.size,
    };
  },

  // Validate asset metadata
  validateAssetMetadata(metadata) {
    const errors = [];
    
    if (!metadata.title || metadata.title.trim().length < 3) {
      errors.push('Title must be at least 3 characters');
    }
    
    if (!metadata.category) {
      errors.push('Category is required');
    }
    
    if (metadata.royalty_percentage) {
      const royalty = parseFloat(metadata.royalty_percentage);
      if (isNaN(royalty) || royalty < 0 || royalty > 50) {
        errors.push('Royalty percentage must be between 0 and 50');
      }
    }
    
    return { valid: errors.length === 0, errors };
  },

  // Validate bid amount
  validateBid(amount, currentBid, startingBid, minIncrement = 1) {
    const minBid = Math.max(currentBid || startingBid, 0) + minIncrement;
    
    if (amount < minBid) {
      return { 
        valid: false, 
        error: `Minimum bid is ${minBid}`,
        minBid,
      };
    }
    
    return { valid: true };
  },
};

// ✅ ADD THIS EXPORT (for server.js)
export function getAllowedFileTypes() {
  return {
    maxSizeMB: FILE_LIMITS.default / 1024 / 1024,
    allowedTypes: Object.values(MAGIC_NUMBERS),
    allowedExtensions: ALLOWED_EXTENSIONS,
    limits: FILE_LIMITS,
  };
}

// Also export ValidationService as default
export default ValidationService; 
