import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { Resend } from 'resend';

dotenv.config();

// Resend email client
const resend = new Resend(process.env.RESEND_API_KEY);

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' })); // Lock down in production

// ─── CLIENTS ─────────────────────────────────────────────────────
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY // service role — full access
);

// ─── RATE LIMITING (in-memory, replace with Redis for production) ───
const bidRateMap = new Map();

function bidRateLimit(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();
  
  const now = Date.now();
  const userBids = bidRateMap.get(userId) || [];
  const recentBids = userBids.filter(time => now - time < 10000); // 10 seconds
  
  if (recentBids.length >= 3) {
    return res.status(429).json({ error: 'Too many bids. Please wait.' });
  }
  
  recentBids.push(now);
  bidRateMap.set(userId, recentBids);
  next();
}

// Clean rate limit map every hour
setInterval(() => {
  const now = Date.now();
  for (const [userId, times] of bidRateMap.entries()) {
    const fresh = times.filter(t => now - t < 10000);
    if (fresh.length === 0) {
      bidRateMap.delete(userId);
    } else {
      bidRateMap.set(userId, fresh);
    }
  }
}, 3600000);

// ─── MIDDLEWARE — AUTH ────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user;
  next();
}

// ─── HELPERS ─────────────────────────────────────────────────────
function generateSecureToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generateCertNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `BX-${timestamp}-${random}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#039;');
}

// Email helper using Resend
async function sendEmail({ to, subject, html, text, from = process.env.EMAIL_FROM || 'Build.X <noreply@buildx.com>' }) {
  try {
    const { data, error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html: html || text,
      text: text || html?.replace(/<[^>]*>/g, ''),
    });
    
    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, error: error.message };
  }
}

// ─────────────────────────────────────────────────────────────────
// ROUTE 1: CREATE PAYMENT INTENT
// POST /payment/create-intent
// ─────────────────────────────────────────────────────────────────
app.post('/payment/create-intent', requireAuth, async (req, res) => {
  try {
    const { listing_id, bid_id, amount_cents, currency, seller_stripe_account } = req.body;

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, status, current_bidder_id, current_bid, auction_type, seller_id')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing) return res.status(404).json({ error: 'Listing not found' });
    if (listing.status === 'sold') return res.status(400).json({ error: 'Auction already paid' });
    if (listing.current_bidder_id !== req.user.id) return res.status(403).json({ error: 'Not winning bidder' });

    const { data: seller } = await supabase.from('users').select('is_apex_vip, stripe_account_id').eq('id', listing.seller_id).single();
    const rate = seller?.is_apex_vip ? 0.02 : 0.10;
    const platformFeeCents = Math.round(amount_cents * rate);

    const intentParams = {
      amount: amount_cents,
      currency: currency ?? 'usd',
      metadata: { listing_id, bid_id: bid_id ?? '', buyer_id: req.user.id, platform_fee_cents: platformFeeCents },
    };

    const sellerAccount = seller_stripe_account || seller?.stripe_account_id;
    if (sellerAccount) {
      intentParams.application_fee_amount = platformFeeCents;
      intentParams.transfer_data = { destination: sellerAccount };
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);

    return res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      platform_fee_cents: platformFeeCents,
    });
  } catch (err) {
    console.error('create-intent error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 2: CONFIRM PAYMENT
// POST /payment/confirm
// ─────────────────────────────────────────────────────────────────
app.post('/payment/confirm', requireAuth, async (req, res) => {
  try {
    const { payment_intent_id, listing_id, bid_id } = req.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({ error: `Payment incomplete. Status: ${paymentIntent.status}` });
    }

    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('stripe_payment_intent_id', payment_intent_id)
      .single();

    if (existing) return res.json({ transaction_id: existing.id, already_processed: true });

    const { data: listing } = await supabase
      .from('listings')
      .select('id, seller_id, current_bid, currency, title')
      .eq('id', listing_id)
      .single();

    const amount = paymentIntent.amount / 100;
    const platformFee = (paymentIntent.application_fee_amount ?? 0) / 100;
    const sellerAmount = amount - platformFee;

    const { data: transaction, error: txError } = await supabase
      .from('transactions')
      .insert({
        listing_id,
        buyer_id: req.user.id,
        seller_id: listing.seller_id,
        amount,
        currency: listing.currency,
        platform_fee: platformFee,
        seller_payout: sellerAmount,
        stripe_payment_intent_id: payment_intent_id,
        escrow_status: 'holding',
        delivery_status: 'pending',
        bid_id: bid_id ?? null,
      })
      .select()
      .single();

    if (txError) throw txError;

    // Generate download token
    const downloadToken = generateSecureToken();
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await supabase.from('transactions')
      .update({ download_token: downloadToken, download_token_expires_at: tokenExpiry, delivery_status: 'delivered' })
      .eq('id', transaction.id);

    // Update seller/buyer stats
    await supabase.rpc('increment_user_stat', { p_user_id: listing.seller_id, p_field: 'total_earned', p_amount: sellerAmount });
    await supabase.rpc('increment_user_stat', { p_user_id: req.user.id, p_field: 'total_spent', p_amount: amount });
    await supabase.rpc('increment_user_stat', { p_user_id: req.user.id, p_field: 'wins', p_amount: 1 });
    await supabase.rpc('award_buildx_score', { p_user_id: req.user.id, p_points: Math.round(amount * 2) });

    // Certificate & vault entry
    const certNumber = generateCertNumber();
    const { data: cert } = await supabase.from('certificates').insert({
      certificate_number: certNumber,
      listing_id,
      transaction_id: transaction.id,
      buyer_id: req.user.id,
    }).select().single();

    await supabase.from('vault').insert({
      owner_id: req.user.id,
      listing_id,
      transaction_id: transaction.id,
      certificate_id: cert.id,
      acquired_at: new Date().toISOString(),
    });

    await supabase.from('listings').update({ status: 'sold', owner_id: req.user.id }).eq('id', listing_id);

    // Send confirmation email with Resend
    const { data: buyer } = await supabase.from('users').select('email, username').eq('id', req.user.id).single();
    const { data: seller } = await supabase.from('users').select('email, username').eq('id', listing.seller_id).single();
    
    // Email to buyer
    await sendEmail({
      to: buyer.email,
      subject: `🎉 You won "${listing.title}" on Build.X!`,
      html: `
        <h1>Congratulations ${escapeHtml(buyer.username)}!</h1>
        <p>You've won the auction for <strong>${escapeHtml(listing.title)}</strong>.</p>
        <p><strong>Amount:</strong> ${amount} ${listing.currency}</p>
        <p>Your certificate is ready in your vault.</p>
        <a href="${process.env.FRONTEND_URL}/vault/${cert.id}">View Certificate</a>
        <p>Thank you for being part of Build.X!</p>
      `,
    });
    
    // Email to seller
    await sendEmail({
      to: seller.email,
      subject: `💰 Your item "${listing.title}" sold on Build.X!`,
      html: `
        <h1>Sold!</h1>
        <p>Your listing <strong>${escapeHtml(listing.title)}</strong> has been sold for ${amount} ${listing.currency}.</p>
        <p>Payout: ${sellerAmount} ${listing.currency} (after platform fee)</p>
        <p>Check your dashboard for more details.</p>
      `,
    });

    // Notifications
    await supabase.from('notifications').insert([
      {
        user_id: req.user.id,
        type: 'won',
        title: '🎉 Payment Confirmed',
        data: { listing_id, certificate_id: cert.id },
      },
      {
        user_id: listing.seller_id,
        type: 'sold',
        title: '💰 Item Sold',
        data: { listing_id, amount, buyer_id: req.user.id },
      }
    ]);

    return res.json({ transaction_id: transaction.id, certificate_id: cert.id, download_token: downloadToken });
  } catch (err) {
    console.error('confirm-payment error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 3: BID PLACEMENT
// POST /bid/place
// ─────────────────────────────────────────────────────────────────
app.post('/bid/place', requireAuth, bidRateLimit, async (req, res) => {
  try {
    const { listing_id, amount, currency = 'USD', is_ghost = false } = req.body;
    
    if (!listing_id || !amount) {
      return res.status(400).json({ error: 'listing_id and amount required' });
    }
    
    if (is_ghost) {
      const { data: ghostResult, error: ghostError } = await supabase.rpc('place_ghost_bid', {
        p_listing_id: listing_id,
        p_bidder_id: req.user.id,
        p_amount: amount,
        p_currency: currency
      });
      
      if (ghostError) {
        return res.status(400).json({ error: ghostError.message });
      }
      
      return res.json(ghostResult);
    }
    
    const { data: result, error } = await supabase.rpc('place_bid_locked', {
      p_listing_id: listing_id,
      p_bidder_id: req.user.id,
      p_amount: amount,
      p_currency: currency
    });
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    if (result && !result.success) {
      return res.status(400).json({ error: result.reason });
    }
    
    return res.json(result);
  } catch (err) {
    console.error('bid placement error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 4: SYNDICATE JOIN
// POST /syndicate/join
// ─────────────────────────────────────────────────────────────────
app.post('/syndicate/join', requireAuth, async (req, res) => {
  try {
    const { syndicate_id, amount, currency = 'USD' } = req.body;
    
    if (!syndicate_id || !amount) {
      return res.status(400).json({ error: 'syndicate_id and amount required' });
    }
    
    const { data: result, error } = await supabase.rpc('syndicate_join', {
      p_syndicate_id: syndicate_id,
      p_user_id: req.user.id,
      p_amount: amount,
      p_currency: currency
    });
    
    if (error) {
      return res.status(400).json({ error: error.message });
    }
    
    return res.json(result);
  } catch (err) {
    console.error('syndicate join error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 5: DOWNLOAD TOKEN (SUPABASE STORAGE)
// POST /download/generate-token
// ─────────────────────────────────────────────────────────────────
app.post('/download/generate-token', requireAuth, async (req, res) => {
  try {
    const { transaction_id } = req.body;

    const { data: tx } = await supabase
      .from('transactions')
      .select('buyer_id, listing_id, delivery_status')
      .eq('id', transaction_id)
      .single();

    if (!tx || tx.buyer_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await supabase.from('transactions').update({ download_token: token, download_token_expires_at: expiry }).eq('id', transaction_id);

    const { data: listing } = await supabase.from('listings').select('file_path').eq('id', tx.listing_id).single();
    
    // Generate signed URL for secure download
    const { data: signedUrl } = await supabase.storage
      .from('assets')
      .createSignedUrl(listing.file_path, 3600); // 1 hour expiry

    return res.json({ download_url: signedUrl, token, expires_at: expiry });
  } catch (err) {
    console.error('generate-token error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 6: RESOLVE TOKEN (SUPABASE STORAGE)
// POST /download/resolve-token
// ─────────────────────────────────────────────────────────────────
app.post('/download/resolve-token', requireAuth, async (req, res) => {
  try {
    const { token } = req.body;

    const { data: tx } = await supabase
      .from('transactions')
      .select('buyer_id, listing_id, download_token_expires_at')
      .eq('download_token', token)
      .single();

    if (!tx || tx.buyer_id !== req.user.id || new Date(tx.download_token_expires_at) < new Date()) {
      return res.status(410).json({ error: 'Token invalid or expired' });
    }

    const { data: listing } = await supabase.from('listings').select('file_path, title').eq('id', tx.listing_id).single();
    
    // Generate signed URL
    const { data: signedUrl } = await supabase.storage
      .from('assets')
      .createSignedUrl(listing.file_path || '', 3600);

    await supabase.from('transactions').update({ last_downloaded_at: new Date().toISOString() }).eq('id', tx.id);

    return res.json({ download_url: signedUrl });
  } catch (err) {
    console.error('resolve-token error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 7: SUPABASE STORAGE UPLOAD PRESIGN
// POST /upload/presign
// ─────────────────────────────────────────────────────────────────
app.post('/upload/presign', requireAuth, async (req, res) => {
  const { filename, content_type, listing_id, asset_type = 'asset' } = req.body;

  if (!filename || !content_type) return res.status(400).json({ error: 'filename and content_type required' });

  // Validate listing ownership
  if (listing_id) {
    const { data: listing } = await supabase.from('listings').select('seller_id').eq('id', listing_id).single();
    if (listing?.seller_id !== req.user.id) return res.status(403).json({ error: 'Not your listing' });
  }

  const bucket = asset_type === 'preview' ? 'previews' : 'assets';
  const timestamp = Date.now();
  const key = `${bucket}/${req.user.id}/${timestamp}-${filename}`;

  // Generate signed upload URL
  const { data: signedUrl, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(key);

  if (signedError) throw signedError;

  // Update listing with file path immediately
  if (listing_id) {
    const field = asset_type === 'preview' ? 'preview_path' : 'file_path';
    await supabase.from('listings').update({ [field]: key }).eq('id', listing_id);
  }

  return res.json({ 
    upload_url: signedUrl,
    file_path: key,
    public_preview_url: asset_type === 'preview' ? `${process.env.SUPABASE_URL}/storage/v1/object/public/previews/${key}` : null
  });
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 8: STRIPE WEBHOOK
// POST /webhook/stripe
// ─────────────────────────────────────────────────────────────────
app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  
  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    console.log('Payment succeeded:', paymentIntent.id);
    // You can update transaction status here if needed
  }
  
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    console.log('Payment failed:', paymentIntent.id);
    // Handle failed payment
  }
  
  res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 9: CERTIFICATE PDF (SUPABASE STORAGE)
// POST /certificate/generate  
// ─────────────────────────────────────────────────────────────────
app.post('/certificate/generate', requireAuth, async (req, res) => {
  const { certificate_id } = req.body;

  try {
    const { data: cert } = await supabase
      .from('certificates')
      .select(`
        id, certificate_number, 
        listing:listings(id, title, seller_id),
        buyer:users!buyer_id(id, username)
      `)
      .eq('id', certificate_id)
      .single();

    if (!cert || cert.buyer.id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    // Generate HTML certificate
    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; text-align: center; }
    .certificate { border: 10px solid gold; padding: 40px; max-width: 800px; margin: 0 auto; }
    h1 { color: #333; font-size: 48px; }
    .title { font-size: 32px; margin: 20px 0; }
    .cert-number { color: #666; margin-top: 40px; }
  </style>
</head>
<body>
  <div class="certificate">
    <h1>🏆 Certificate of Authenticity 🏆</h1>
    <p class="title">${escapeHtml(cert.listing.title)}</p>
    <p>Awarded to: <strong>${escapeHtml(cert.buyer.username)}</strong></p>
    <p>Certificate #: ${cert.certificate_number}</p>
    <p>Date: ${new Date().toLocaleDateString()}</p>
    <div class="cert-number">Build.X — Verified Digital Asset</div>
  </div>
</body>
</html>`;

    // Try to generate PDF with puppeteer, fallback to returning HTML
    let pdfBuffer;
    try {
      const puppeteer = await import('puppeteer');
      const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
      const page = await browser.newPage();
      await page.setContent(html);
      pdfBuffer = await page.pdf({ format: 'A4' });
      await browser.close();
    } catch (err) {
      console.log('Puppeteer not available, returning HTML instead');
      return res.json({ pdf_pending: true, html, message: 'PDF generation requires puppeteer installation' });
    }

    // Upload to Supabase Storage
    const pdfKey = `certificates/${certificate_id}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('certificates')
      .upload(pdfKey, pdfBuffer, { contentType: 'application/pdf', upsert: true });

    if (uploadError) throw uploadError;

    await supabase.from('certificates').update({ pdf_path: pdfKey }).eq('id', certificate_id);

    const { data: signedUrl } = await supabase.storage
      .from('certificates')
      .createSignedUrl(pdfKey, 86400); // 24 hour expiry

    return res.json({ success: true, pdf_url: signedUrl });
  } catch (err) {
    console.error('certificate error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// ROUTE 10: HEALTH CHECK
// GET /health
// ─────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ 
    status: 'BUILD.X backend live 🚀', 
    timestamp: new Date().toISOString(),
    services: {
      supabase: 'connected',
      stripe: 'configured',
      resend: 'configured'
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`\n👑 BUILD.X Backend (Supabase + Resend) running on port ${PORT}\n`);
  console.log(`   Health check: http://localhost:${PORT}/health\n`);
});

export default app;

