// services/escrowService.js
import { supabase } from '../lib/supabase.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const EscrowService = {
  // Create escrow for a transaction
  async createEscrow({ transactionId, buyerId, sellerId, amount, currency, assetHash }) {
    try {
      // Create escrow record in database
      const { data: escrow, error } = await supabase
        .from('escrow_transactions')
        .insert({
          transaction_id: transactionId,
          buyer_id: buyerId,
          seller_id: sellerId,
          amount,
          currency,
          asset_hash: assetHash,
          status: 'pending',
        })
        .select()
        .single();

      if (error) throw error;

      return { success: true, escrow };
    } catch (error) {
      console.error('Create escrow error:', error);
      return { success: false, error: error.message };
    }
  },

  // Release escrow (buyer confirms asset is good)
  async releaseEscrow(escrowId, receivedHash) {
    try {
      // Get escrow details
      const { data: escrow, error: fetchError } = await supabase
        .from('escrow_transactions')
        .select('*')
        .eq('id', escrowId)
        .single();

      if (fetchError) throw fetchError;

      // Verify hash matches
      if (escrow.asset_hash !== receivedHash) {
        // Auto-create dispute
        await this.createDispute(escrow.transaction_id, 'Hash mismatch - file corrupted or wrong file');
        return { success: false, error: 'Hash mismatch. Dispute opened.', disputeOpened: true };
      }

      // Release payment to seller
      const { data: transaction } = await supabase
        .from('transactions')
        .select('stripe_payment_intent_id, amount')
        .eq('id', escrow.transaction_id)
        .single();

      if (transaction?.stripe_payment_intent_id) {
        // Capture the payment (if using separate auth/capture)
        await stripe.paymentIntents.capture(transaction.stripe_payment_intent_id);
      }

      // Update escrow status
      const { error: updateError } = await supabase
        .from('escrow_transactions')
        .update({ 
          status: 'released', 
          released_at: new Date().toISOString(),
          verified_hash: receivedHash,
        })
        .eq('id', escrowId);

      if (updateError) throw updateError;

      // Update transaction status
      await supabase
        .from('transactions')
        .update({ escrow_status: 'released', released_at: new Date().toISOString() })
        .eq('id', escrow.transaction_id);

      // Notify seller
      await supabase.from('notifications').insert({
        user_id: escrow.seller_id,
        type: 'escrow_released',
        title: 'Payment Released',
        body: `Payment of ${escrow.amount} ${escrow.currency} has been released to you.`,
        data: { transaction_id: escrow.transaction_id },
      });

      return { success: true };
    } catch (error) {
      console.error('Release escrow error:', error);
      return { success: false, error: error.message };
    }
  },

  // Refund escrow (for disputes)
  async refundEscrow(escrowId, reason) {
    try {
      const { data: escrow, error: fetchError } = await supabase
        .from('escrow_transactions')
        .select('*, transaction:transactions(*)')
        .eq('id', escrowId)
        .single();

      if (fetchError) throw fetchError;

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
  },

  // Auto-release expired escrow (cron job)
  async autoReleaseExpiredEscrow(days = 7) {
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
        // Auto-release without hash verification (trust buyer didn't dispute)
        const result = await this.releaseEscrow(escrow.id, escrow.asset_hash);
        results.push({ escrow_id: escrow.id, ...result });
      }

      return { success: true, released: results.length, results };
    } catch (error) {
      console.error('Auto-release expired escrow error:', error);
      return { success: false, error: error.message };
    }
  },

  // Get escrow by transaction
  async getEscrowByTransaction(transactionId) {
    try {
      const { data, error } = await supabase
        .from('escrow_transactions')
        .select('*')
        .eq('transaction_id', transactionId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return { success: true, escrow: data || null };
    } catch (error) {
      console.error('Get escrow error:', error);
      return { success: false, error: error.message };
    }
  },

  // Create dispute from escrow
  async createDispute(transactionId, reason) {
    try {
      const { data, error } = await supabase
        .from('disputes')
        .insert({
          transaction_id: transactionId,
          reason,
          status: 'open',
        })
        .select()
        .single();

      if (error) throw error;

      // Update escrow status
      await supabase
        .from('escrow_transactions')
        .update({ status: 'disputed' })
        .eq('transaction_id', transactionId);

      return { success: true, dispute: data };
    } catch (error) {
      console.error('Create dispute error:', error);
      return { success: false, error: error.message };
    }
  },
};
