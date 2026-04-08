// services/hashService.js
import crypto from 'crypto';

// Generate SHA-256 hash from buffer
export function generateHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Generate hash from file (browser/Node compatible)
export async function generateFileHash(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      const buffer = Buffer.from(reader.result);
      const hash = generateHash(buffer);
      resolve(hash);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Generate hash from buffer (Node only)
export function generateBufferHash(buffer) {
  return generateHash(buffer);
}

// Compare two hashes (timing-safe)
export function compareHashes(hash1, hash2) {
  if (!hash1 || !hash2) return false;
  return crypto.timingSafeEqual(Buffer.from(hash1), Buffer.from(hash2));
}

// Generate short hash (for display)
export function getShortHash(hash, length = 8) {
  if (!hash) return '';
  return hash.slice(0, length);
}

// Generate multiple hashes (different algorithms)
export function generateMultipleHashes(buffer) {
  return {
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    sha512: crypto.createHash('sha512').update(buffer).digest('hex'),
    md5: crypto.createHash('md5').update(buffer).digest('hex'),
  };
}

// Verify file integrity by comparing hash
export async function verifyFileIntegrity(file, expectedHash) {
  const actualHash = await generateFileHash(file);
  return compareHashes(actualHash, expectedHash);
}
