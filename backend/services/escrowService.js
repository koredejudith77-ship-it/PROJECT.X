// services/escrowService.js
import { supabase } from '../lib/supabase.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Release escrow (when seller delivers)
export async function releaseEscrow(transactionId, userId, isAdmin = false) {
  try {
    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .select('id, seller_id, escrow_status, stripe_payment_intent_id, amount')
      .eq('id', transactionId)
      .single();
    
    if (txError) throw new Error('Transaction not found');
    if (transaction.escrow_status !== 'holding') {
      throw new Error('Escrow not in holding state');
    }
    if (transaction.seller_id !== userId && !isAdmin) {
      throw new Error('Only seller or admin can release escrow');
    }
    
    if (transaction.stripe_payment_intent_id) {
      await stripe.paymentIntents.capture(transaction.stripe_payment_intent_id);
    }
    
    const { error: updateError } = await supabase
      .from('transactions')
      .update({ escrow_status: 'released', released_at: new Date().toISOString() })
      .eq('id', transactionId);
    
    if (updateError) throw updateError;
    
    // Notify buyer
    await supabase.from('notifications').insert({
      user_id: transaction.buyer_id,
      type: 'escrow_released',
      title: 'Escrow Released',
      body: `Payment of ${transaction.amount} has been released to seller.`,
    });
    
    return { success: true };
  } catch (error) {
    console.error('Release escrow error:', error);
    return { success: false, error: error.message };
  }
}

// Refund escrow (for disputes)
export async function refundEscrow(escrowId, reason) {
  try {
    const { data: escrow, error: fetchError } = await supabase
      .from('escrow_transactions')
      .select('*, transaction:transactions(*)')
      .eq('id', escrowId)
      .single();
    
    if (fetchError) throw fetchError;
    if (!escrow) throw new Error('Escrow not found');

    // Process refund via Stripe
    if (escrow.transaction?.stripe_payment_intent_id) {
      await stripe.refunds.create({
        payment_intent: escrow.transaction.stripe_payment_intent_id,
        amount: Math.round(escrow.amount * 100),
      });
    }

    // Update escrow status
    await supabase
      .from('escrow_transactions')
      .update({ 
        status: 'refunded', 
        released_at: new Date().toISOString(),
        refund_reason: reason,
      })
      .eq('id', escrowId);

    // Update transaction status
    await supabase
      .from('transactions')
      .update({ escrow_status: 'refunded' })
      .eq('id', escrow.transaction_id);

    // Notify buyer
    await supabase.from('notifications').insert({
      user_id: escrow.buyer_id,
      type: 'refund_issued',
      title: 'Refund Processed',
      body: `Refund of ${escrow.amount} ${escrow.currency} has been issued.`,
      data: { transaction_id: escrow.transaction_id, reason },
    });

    return { success: true };
  } catch (error) {
    console.error('Refund escrow error:', error);
    return { success: false, error: error.message };
  }
}

// Get escrow by transaction
export async function getEscrowByTransaction(transactionId) {
  try {
    const { data, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('transaction_id', transactionId)
      .single();
    
    if (error && error.code !== 'PGRST116') throw error;
    return { success: true, escrow: data || null };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Auto-release expired escrow (cron job)
export async function autoReleaseExpiredEscrow(days = 7) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const { data: expiredEscrows, error } = await supabase
      .from('escrow_transactions')
      .select('*')
      .eq('status', 'pending')
      .lt('created_at', cutoffDate.toISOString());

    if (error) throw error;

    const results = [];
    for (const escrow of expiredEscrows || []) {
      const result = await releaseEscrow(escrow.transaction_id, escrow.seller_id, true);
      results.push({ escrow_id: escrow.id, ...result });
    }

    return { success: true, released: results.length, results };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Export as object for convenience
export const EscrowService = {
  releaseEscrow,
  refundEscrow,
  getEscrowByTransaction,
  autoReleaseExpiredEscrow,
};
