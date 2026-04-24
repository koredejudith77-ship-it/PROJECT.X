// services/virusScanService.js
import { supabase } from '../lib/supabase.js';
import crypto from 'crypto';

// VirusTotal API integration (free tier available)
const VIRUS_TOTAL_API_KEY = process.env.VIRUS_TOTAL_API_KEY;
const VIRUS_TOTAL_API_URL = 'https://www.virustotal.com/api/v3';

export const VirusScanService = {
  // Scan file using VirusTotal API
  async scanFile(fileBuffer, fileName) {
    if (!VIRUS_TOTAL_API_KEY) {
      console.warn('⚠️ VirusTotal API key missing. Virus scanning disabled.');
      return { success: false, error: 'Virus scanning not configured', skipped: true };
    }

    try {
      // Create form data for upload
      const formData = new FormData();
      const blob = new Blob([fileBuffer]);
      formData.append('file', blob, fileName);

      // Upload to VirusTotal
      const uploadResponse = await fetch('https://www.virustotal.com/api/v3/files', {
        method: 'POST',
        headers: {
          'x-apikey': VIRUS_TOTAL_API_KEY,
        },
        body: formData,
      });

      const uploadData = await uploadResponse.json();
      if (!uploadResponse.ok) {
        throw new Error(uploadData.error?.message || 'Upload failed');
      }

      const analysisId = uploadData.data.id;

      // Wait for analysis (polling)
      let analysisResult;
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds max wait

      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
        
        const resultResponse = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, {
          headers: { 'x-apikey': VIRUS_TOTAL_API_KEY },
        });
        
        analysisResult = await resultResponse.json();
        
        if (analysisResult.data.attributes.status === 'completed') {
          break;
        }
        attempts++;
      }

      const stats = analysisResult.data.attributes.stats;
      const isMalicious = (stats.malicious || 0) > 0;
      const isSuspicious = (stats.suspicious || 0) > 0;

      return {
        success: true,
        isMalicious,
        isSuspicious,
        stats: {
          malicious: stats.malicious || 0,
          suspicious: stats.suspicious || 0,
          undetected: stats.undetected || 0,
          harmless: stats.harmless || 0,
          timeout: stats.timeout || 0,
        },
        scanId: analysisId,
      };
    } catch (error) {
      console.error('Virus scan error:', error);
      return { success: false, error: error.message };
    }
  },

  // Scan file hash against known malware database
  async scanHash(fileHash) {
    if (!VIRUS_TOTAL_API_KEY) {
      return { success: false, skipped: true };
    }

    try {
      const response = await fetch(`${VIRUS_TOTAL_API_URL}/files/${fileHash}`, {
        headers: { 'x-apikey': VIRUS_TOTAL_API_KEY },
      });

      if (response.status === 404) {
        return { success: true, found: false, message: 'Hash not found in database' };
      }

      const data = await response.json();
      const stats = data.data.attributes.last_analysis_stats;

      return {
        success: true,
        found: true,
        isMalicious: (stats.malicious || 0) > 0,
        stats: {
          malicious: stats.malicious || 0,
          suspicious: stats.suspicious || 0,
        },
      };
    } catch (error) {
      console.error('Hash scan error:', error);
      return { success: false, error: error.message };
    }
  },

  // Block a file hash (add to blacklist)
  async blockFileHash(fileHash, reason, userId) {
    try {
      const { data, error } = await supabase
        .from('blocked_files')
        .insert({
          file_hash: fileHash,
          reason,
          blocked_by: userId,
          detected_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      return { success: true, blocked: data };
    } catch (error) {
      console.error('Block file hash error:', error);
      return { success: false, error: error.message };
    }
  },

  // Get list of blocked files
  async getBlockedFiles(limit = 100) {
    try {
      const { data, error } = await supabase
        .from('blocked_files')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return { success: true, blockedFiles: data };
    } catch (error) {
      console.error('Get blocked files error:', error);
      return { success: false, error: error.message }
    }
  }
};

export { scanFile, scanFileHash };
