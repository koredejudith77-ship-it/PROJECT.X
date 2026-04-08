// jobs/cleanupTempFiles.js
import { supabase } from '../lib/supabase.js';
import { storageService } from '../services/storageService.js';

// Clean up temporary files older than X hours
export async function cleanupTempFiles(maxAgeHours = 24) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - maxAgeHours);

    // Find temporary files (unverified uploads, expired drafts)
    const { data: oldFiles, error } = await supabase
      .from('temp_uploads')
      .select('id, file_path, bucket')
      .lt('created_at', cutoffDate.toISOString())
      .eq('status', 'pending');

    if (error) throw error;

    let deleted = 0;
    for (const file of oldFiles || []) {
      // Delete from storage
      await storageService.deleteFile(file.file_path, file.bucket);
      
      // Delete record
      await supabase.from('temp_uploads').delete().eq('id', file.id);
      deleted++;
    }

    console.log(`🧹 Cleaned up ${deleted} temporary files older than ${maxAgeHours} hours`);
    return { success: true, deleted };
  } catch (error) {
    console.error('Cleanup temp files error:', error);
    return { success: false, error: error.message };
  }
}

// Clean up expired download tokens
export async function cleanupExpiredTokens() {
  try {
    const { data: expiredTokens, error } = await supabase
      .from('transactions')
      .select('id, download_token')
      .lt('download_token_expires_at', new Date().toISOString())
      .not('download_token', 'is', null);

    if (error) throw error;

    let cleared = 0;
    for (const token of expiredTokens || []) {
      await supabase
        .from('transactions')
        .update({ download_token: null, download_token_expires_at: null })
        .eq('id', token.id);
      cleared++;
    }

    console.log(`🧹 Cleared ${cleared} expired download tokens`);
    return { success: true, cleared };
  } catch (error) {
    console.error('Cleanup expired tokens error:', error);
    return { success: false, error: error.message };
  }
}

// Clean up old audit logs (keep last 90 days)
export async function cleanupOldAuditLogs(retentionDays = 90) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const { data, error } = await supabase
      .from('audit_logs')
      .delete()
      .lt('created_at', cutoffDate.toISOString())
      .select();

    if (error) throw error;

    console.log(`🧹 Deleted ${data?.length || 0} old audit logs (older than ${retentionDays} days)`);
    return { success: true, deleted: data?.length || 0 };
  } catch (error) {
    console.error('Cleanup old audit logs error:', error);
    return { success: false, error: error.message };
  }
}

// Run all cleanup jobs
export async function runAllCleanups() {
  console.log('🧹 Starting cleanup jobs...');
  
  const results = {
    tempFiles: await cleanupTempFiles(24),
    expiredTokens: await cleanupExpiredTokens(),
    oldAuditLogs: await cleanupOldAuditLogs(90),
  };
  
  console.log('✅ Cleanup jobs completed', results);
  return results;
}

// If run directly via node
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllCleanups().then(() => process.exit(0));
}
