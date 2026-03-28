import express from 'express';
import cors from 'cors';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { Resend } from 'resend';
import { WebSocketServer } from 'ws';
import http from 'http';

dotenv.config();

// ============================================
// SENTRY - Error Tracking (Optional - Safe)
// ============================================
let Sentry;
let nodeProfilingIntegration;
if (process.env.SENTRY_DSN) {
  try {
    const sentryModule = await import('@sentry/node');
    Sentry = sentryModule.default || sentryModule;
    const profiling = await import('@sentry/profiling-node');
    nodeProfilingIntegration = profiling.nodeProfilingIntegration;
  } catch (err) {
    console.warn('⚠️ Sentry not installed, skipping...');
  }
}

// ============================================
// POSTHOG - Analytics (Optional - Safe)
// ============================================
let PostHog;
let posthog = null;
if (process.env.POSTHOG_API_KEY) {
  try {
    const posthogModule = await import('posthog-node');
    PostHog = posthogModule.PostHog || posthogModule.default;
    posthog = new PostHog(process.env.POSTHOG_API_KEY, {
      host: process.env.POSTHOG_HOST || 'https://app.posthog.com',
      flushAt: 20,
      flushInterval: 10000,
    });
  } catch (err) {
    console.warn('⚠️ PostHog not installed, skipping...');
  }
}

// ============================================
// INITIALIZATION
// ============================================
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ============================================
// SENTRY INITIALIZATION
// ============================================
if (Sentry && process.env.SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      integrations: nodeProfilingIntegration ? [nodeProfilingIntegration()] : [],
      tracesSampleRate: 1.0,
      profilesSampleRate: 1.0,
      environment: process.env.NODE_ENV || 'production',
    });
    
    app.use(Sentry.Handlers.requestHandler());
    app.use(Sentry.Handlers.tracingHandler());
    console.log('✅ Sentry initialized');
  } catch (err) {
    console.warn('⚠️ Sentry init failed:', err.message);
  }
}

app.use(express.json());
app.use(cors({ origin: '*' }));

// ============================================
// POSTHOG HELPERS
// ============================================
function captureEvent(eventName, userId, properties = {}) {
  if (posthog && userId) {
    try {
      posthog.capture({
        distinctId: userId,
        event: eventName,
        properties: { timestamp: new Date().toISOString(), ...properties },
      });
    } catch (err) {
      console.warn('PostHog capture failed:', err.message);
    }
  }
}

function identifyUser(userId, traits = {}) {
  if (posthog && userId) {
    try {
      posthog.identify({ distinctId: userId, properties: traits });
    } catch (err) {
      console.warn('PostHog identify failed:', err.message);
    }
  }
}

// ============================================
// WEBSOCKET (Voice/Audio)
// ============================================
const rooms = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const listingId = url.searchParams.get('listingId');
  const userId = url.searchParams.get('userId');

  if (!listingId || !userId) {
    ws.close();
    return;
  }

  if (!rooms.has(listingId)) rooms.set(listingId, new Map());
  const room = rooms.get(listingId);
  room.set(userId, ws);

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    for (const [otherUserId, client] of room.entries()) {
      if (otherUserId !== userId && client.readyState === 1) {
        client.send(
          JSON.stringify({
            type: message.type,
            userId,
            data: message.data,
            timestamp: Date.now(),
          })
        );
      }
    }
  });

  ws.on('close', () => {
    room.delete(userId);
    if (room.size === 0) rooms.delete(listingId);
  });
});

// ============================================
// MIDDLEWARE
// ============================================
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid token' });

  req.user = user;
  next();
}

const bidRateMap = new Map();

function bidRateLimit(req, res, next) {
  const userId = req.user?.id;
  if (!userId) return next();

  const now = Date.now();
  const userBids = bidRateMap.get(userId) || [];
  const recentBids = userBids.filter((time) => now - time < 10000);

  if (recentBids.length >= 3) {
    return res.status(429).json({ error: 'Too many bids. Please wait.' });
  }

  recentBids.push(now);
  bidRateMap.set(userId, recentBids);
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [userId, times] of bidRateMap.entries()) {
    const fresh = times.filter((t) => now - t < 10000);
    if (fresh.length === 0) bidRateMap.delete(userId);
    else bidRateMap.set(userId, fresh);
  }
}, 3600000);

// ============================================
// HELPERS
// ============================================
function generateSecureToken() {
  return crypto.randomBytes(48).toString('hex');
}

function generateCertNumber() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `BX-${timestamp}-${random}`;
}

async function sendExpoPushNotification(pushToken, title, body, data = {}) {
  if (!pushToken) return false;

  const message = { to: pushToken, sound: 'default', title, body, data };

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });
    const result = await response.json();
    return result.data?.status === 'ok';
  } catch (error) {
    console.error('Expo push error:', error);
    return false;
  }
}

async function sendPushNotification(userId, title, body, data = {}) {
  const { data: user } = await supabase
    .from('users')
    .select('push_token')
    .eq('id', userId)
    .single();

  if (!user?.push_token) return false;
  return sendExpoPushNotification(user.push_token, title, body, data);
}

async function sendEmail({ to, subject, html, text, from = process.env.EMAIL_FROM }) {
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

// ============================================
// CORE ROUTES
// ============================================
app.post('/escrow/release', requireAuth, async (req, res) => {
  try {
    const { transaction_id } = req.body;

    const { data: transaction } = await supabase
      .from('transactions')
      .select('id, seller_id, escrow_status')
      .eq('id', transaction_id)
      .single();

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });
    if (transaction.seller_id !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ error: 'Only seller can release escrow' });
    }
    if (transaction.escrow_status !== 'holding') {
      return res.status(400).json({ error: 'Escrow not in holding state' });
    }

    await supabase
      .from('transactions')
      .update({ escrow_status: 'released', released_at: new Date().toISOString() })
      .eq('id', transaction_id);

    const { data: buyer } = await supabase
      .from('transactions')
      .select('buyer_id')
      .eq('id', transaction_id)
      .single();
    await sendPushNotification(
      buyer.buyer_id,
      'Escrow Released',
      'Your payment has been released to the seller.'
    );

    res.json({ success: true, message: 'Escrow released' });
  } catch (err) {
    console.error('escrow release error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/cron/close-auctions', async (req, res) => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: endedAuctions } = await supabase
      .from('listings')
      .update({ status: 'ended' })
      .eq('status', 'live')
      .lt('ends_at', new Date().toISOString())
      .select();

    res.json({ closed: endedAuctions?.length || 0 });
  } catch (err) {
    console.error('cron close-auctions error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/cron/dutch-price-drop', async (req, res) => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { data: dutchAuctions } = await supabase
      .from('listings')
      .select('id, current_bid, starting_bid, auction_data')
      .eq('auction_type', 'dutch')
      .eq('status', 'live');

    let dropped = 0;
    for (const auction of dutchAuctions || []) {
      const dropAmount = auction.auction_data?.drop_amount || 10;
      const newPrice = (auction.current_bid || auction.starting_bid) - dropAmount;

      if (newPrice > 0) {
        await supabase
          .from('listings')
          .update({ current_bid: newPrice })
          .eq('id', auction.id);
        dropped++;
      }
    }

    res.json({ dropped });
  } catch (err) {
    console.error('cron dutch-price-drop error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/cron/payment-deadlines', async (req, res) => {
  try {
    const cronSecret = req.headers['x-cron-secret'];
    if (cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const expired = await supabase
      .from('listings')
      .update({ status: 'ended', winner_id: null })
      .eq('status', 'sold')
      .lt('payment_deadline', new Date().toISOString());

    res.json({ expired: expired.data?.length || 0 });
  } catch (err) {
    console.error('cron payment-deadlines error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/upload/file', requireAuth, async (req, res) => {
  const { filename, content_type, listing_id, asset_type = 'asset' } = req.body;
  if (!filename || !content_type)
    return res.status(400).json({ error: 'filename and content_type required' });

  if (listing_id) {
    const { data: listing } = await supabase
      .from('listings')
      .select('seller_id')
      .eq('id', listing_id)
      .single();
    if (listing?.seller_id !== req.user.id)
      return res.status(403).json({ error: 'Not your listing' });
  }

  const bucket = asset_type === 'preview' ? 'previews' : 'assets';
  const timestamp = Date.now();
  const key = `${bucket}/${req.user.id}/${timestamp}-${filename}`;
  const { data: signedUrl, error: signedError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(key);
  if (signedError) throw signedError;

  if (listing_id) {
    const field = asset_type === 'preview' ? 'preview_path' : 'file_path';
    await supabase
      .from('listings')
      .update({ [field]: key })
      .eq('id', listing_id);
  }

  res.json({ upload_url: signedUrl, file_path: key });
});

// ============================================
// STRIPE PAYMENT SHEET
// ============================================
app.post('/payment/payment-sheet', requireAuth, async (req, res) => {
  try {
    const { amount, currency = 'usd', listing_id } = req.body;
    if (!amount) return res.status(400).json({ error: 'Amount required' });

    const { data: user } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', req.user.id)
      .single();

    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: { supabase_id: req.user.id },
      });
      customerId = customer.id;
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.user.id);
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency,
      customer: customerId,
      payment_method_types: ['card'],
      metadata: { listing_id, user_id: req.user.id },
    });

    const ephemeralKey = await stripe.ephemeralKeys.create(
      { customer: customerId },
      { apiVersion: '2025-02-24' }
    );

    res.json({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: customerId,
    });
  } catch (err) {
    console.error('payment-sheet error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SUBSCRIPTIONS (Apex & Legend - Monthly/Yearly)
// ============================================
app.post('/subscription/create', requireAuth, async (req, res) => {
  try {
    const { tier, duration = 'monthly', payment_method_id } = req.body;
    if (!tier || !['apex', 'legend'].includes(tier)) {
      return res.status(400).json({ error: 'Valid tier required: apex or legend' });
    }

    let priceId;
    if (tier === 'apex') {
      priceId =
        duration === 'monthly'
          ? process.env.APEX_MONTHLY_PRICE_ID
          : process.env.APEX_YEARLY_PRICE_ID;
    } else {
      priceId =
        duration === 'monthly'
          ? process.env.LEGEND_MONTHLY_PRICE_ID
          : process.env.LEGEND_YEARLY_PRICE_ID;
    }

    if (!priceId) {
      return res.status(400).json({ error: 'Price ID not configured' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('stripe_customer_id, email')
      .eq('id', req.user.id)
      .single();

    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_id: req.user.id },
      });
      customerId = customer.id;
      await supabase
        .from('users')
        .update({ stripe_customer_id: customerId })
        .eq('id', req.user.id);
    }

    if (payment_method_id) {
      await stripe.paymentMethods.attach(payment_method_id, { customer: customerId });
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: payment_method_id },
      });
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      metadata: { tier, duration, user_id: req.user.id },
    });

    const vipTier = tier === 'apex' ? 'elite' : 'legend';
    await supabase
      .from('users')
      .update({
        vip_tier: vipTier,
        is_apex_vip: true,
        subscription_tier: tier,
        subscription_duration: duration,
        subscription_id: subscription.id,
      })
      .eq('id', req.user.id);

    captureEvent('subscription_created', req.user.id, { tier, duration });

    res.json({
      subscription_id: subscription.id,
      client_secret: subscription.latest_invoice?.payment_intent?.client_secret,
      tier: vipTier,
      duration,
    });
  } catch (err) {
    console.error('subscription create error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/subscription/cancel', requireAuth, async (req, res) => {
  try {
    const { subscription_id } = req.body;
    if (!subscription_id)
      return res.status(400).json({ error: 'subscription_id required' });

    const subscription = await stripe.subscriptions.update(subscription_id, {
      cancel_at_period_end: true,
    });
    res.json({ subscription_id: subscription.id, cancel_at_period_end: true });
  } catch (err) {
    console.error('subscription cancel error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// CRYPTO PAYMENTS (WalletConnect)
// ============================================
app.post('/payment/crypto', requireAuth, async (req, res) => {
  try {
    const { listing_id, amount, currency = 'ETH', wallet_address } = req.body;

    if (!listing_id || !amount || !wallet_address) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const { data: listing } = await supabase
      .from('listings')
      .select('id, seller_id')
      .eq('id', listing_id)
      .single();

    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const paymentId = generateSecureToken();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: payment, error } = await supabase
      .from('crypto_payments')
      .insert({
        id: paymentId,
        listing_id,
        buyer_id: req.user.id,
        seller_id: listing.seller_id,
        amount,
        currency,
        wallet_address,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (error) throw error;

    captureEvent('crypto_payment_initiated', req.user.id, {
      listing_id,
      amount,
      currency,
    });

    res.json({
      payment_id: paymentId,
      wallet_address: process.env.CRYPTO_WALLET_ADDRESS || '0x...',
      amount,
      currency,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error('crypto payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/crypto', express.json(), async (req, res) => {
  try {
    const { payment_id, transaction_hash, status } = req.body;

    if (status === 'confirmed') {
      const { data: payment } = await supabase
        .from('crypto_payments')
        .update({
          status: 'confirmed',
          transaction_hash,
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', payment_id)
        .select()
        .single();

      if (payment) {
        await supabase.from('transactions').insert({
          listing_id: payment.listing_id,
          buyer_id: payment.buyer_id,
          seller_id: payment.seller_id,
          amount: payment.amount,
          currency: payment.currency,
          platform_fee: payment.amount * 0.1,
          seller_amount: payment.amount * 0.9,
          payment_method: 'crypto',
          payment_reference: transaction_hash,
          escrow_status: 'holding',
          delivery_status: 'pending',
        });

        await sendPushNotification(
          payment.buyer_id,
          'Crypto Payment Confirmed',
          `Payment of ${payment.amount} ${payment.currency} confirmed.`
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error('crypto webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// STRIPE WEBHOOK
// ============================================
app.post(
  '/webhook/stripe',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err) {
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object;
      const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
      const priceId = subscription.items.data[0].price.id;

      let vipTier = 'builder';
      if (
        priceId === process.env.APEX_MONTHLY_PRICE_ID ||
        priceId === process.env.APEX_YEARLY_PRICE_ID
      ) {
        vipTier = 'elite';
      } else if (
        priceId === process.env.LEGEND_MONTHLY_PRICE_ID ||
        priceId === process.env.LEGEND_YEARLY_PRICE_ID
      ) {
        vipTier = 'legend';
      }

      await supabase
        .from('users')
        .update({ vip_tier: vipTier, is_apex_vip: true })
        .eq('stripe_customer_id', subscription.customer);
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object;
      await supabase
        .from('users')
        .update({ vip_tier: 'builder', is_apex_vip: false })
        .eq('stripe_customer_id', subscription.customer);
    }

    res.json({ received: true });
  }
);

// ============================================
// PUSH NOTIFICATIONS (Expo)
// ============================================
app.post('/notifications/register-token', requireAuth, async (req, res) => {
  try {
    const { push_token } = req.body;
    if (!push_token) return res.status(400).json({ error: 'push_token required' });

    await supabase
      .from('users')
      .update({ push_token })
      .eq('id', req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('register token error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/notifications/send', requireAuth, async (req, res) => {
  try {
    const { user_id, title, body, data } = req.body;

    const { data: user } = await supabase
      .from('users')
      .select('is_admin')
      .eq('id', req.user.id)
      .single();
    if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });

    const result = await sendPushNotification(user_id, title, body, data);
    res.json({ success: result });
  } catch (err) {
    console.error('send notification error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// VOICE ROOMS
// ============================================
app.get('/voice/room/:listingId', requireAuth, async (req, res) => {
  try {
    const { listingId } = req.params;
    const room = rooms.get(listingId);
    const participants = room ? Array.from(room.keys()) : [];
    res.json({
      listing_id: listingId,
      participants,
      participant_count: participants.length,
    });
  } catch (err) {
    console.error('voice room error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// SYNDICATE JOIN
// ============================================
app.post('/syndicate/join', requireAuth, async (req, res) => {
  try {
    const { syndicate_id, amount, currency = 'USD' } = req.body;
    if (!syndicate_id || !amount)
      return res.status(400).json({ error: 'syndicate_id and amount required' });

    const { data: result, error } = await supabase.rpc('syndicate_join', {
      p_syndicate_id: syndicate_id,
      p_user_id: req.user.id,
      p_amount: amount,
      p_currency: currency,
    });

    if (error) return res.status(400).json({ error: error.message });
    if (result && !result.success)
      return res.status(400).json({ error: result.reason });

    const { data: syndicate } = await supabase
      .from('syndicates')
      .select('creator_id, title')
      .eq('id', syndicate_id)
      .single();
    if (syndicate) {
      await sendPushNotification(
        syndicate.creator_id,
        'New Syndicate Member',
        `Someone joined "${syndicate.title}" with ${amount} ${currency}`
      );
    }

    captureEvent('syndicate_joined', req.user.id, { syndicate_id, amount, currency });
    res.json(result);
  } catch (err) {
    console.error('syndicate join error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// BID PLACEMENT
// ============================================
app.post('/bid/place', requireAuth, bidRateLimit, async (req, res) => {
  try {
    const { listing_id, amount, currency = 'USD', is_ghost = false } = req.body;
    if (!listing_id || !amount)
      return res.status(400).json({ error: 'listing_id and amount required' });

    if (is_ghost) {
      const { data: ghostResult, error: ghostError } = await supabase.rpc(
        'place_ghost_bid',
        {
          p_listing_id: listing_id,
          p_bidder_id: req.user.id,
          p_amount: amount,
          p_currency: currency,
        }
      );
      if (ghostError) return res.status(400).json({ error: ghostError.message });
      captureEvent('ghost_bid_placed', req.user.id, { listing_id, amount, currency });
      return res.json(ghostResult);
    }

    const { data: result, error } = await supabase.rpc('place_bid_locked', {
      p_listing_id: listing_id,
      p_bidder_id: req.user.id,
      p_amount: amount,
      p_currency: currency,
    });

    if (error) return res.status(400).json({ error: error.message });
    if (result && !result.success)
      return res.status(400).json({ error: result.reason });

    const { data: listing } = await supabase
      .from('listings')
      .select('current_bidder_id, title')
      .eq('id', listing_id)
      .single();
    if (listing?.current_bidder_id && listing.current_bidder_id !== req.user.id) {
      await sendPushNotification(
        listing.current_bidder_id,
        'You\'ve Been Outbid',
        `Someone bid ${amount} ${currency} on "${listing.title}"`
      );
    }

    captureEvent('bid_placed', req.user.id, { listing_id, amount, currency });
    res.json(result);
  } catch (err) {
    console.error('bid placement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PAYMENT INTENT
// ============================================
app.post('/payment/create-intent', requireAuth, async (req, res) => {
  try {
    const { listing_id, amount_cents, currency, seller_stripe_account } = req.body;

    const { data: listing, error: listingError } = await supabase
      .from('listings')
      .select('id, status, current_bidder_id, seller_id')
      .eq('id', listing_id)
      .single();

    if (listingError || !listing)
      return res.status(404).json({ error: 'Listing not found' });
    if (listing.status === 'sold')
      return res.status(400).json({ error: 'Auction already paid' });
    if (listing.current_bidder_id !== req.user.id)
      return res.status(403).json({ error: 'Not winning bidder' });

    const { data: seller } = await supabase
      .from('users')
      .select('is_apex_vip, stripe_account_id')
      .eq('id', listing.seller_id)
      .single();
    const rate = seller?.is_apex_vip ? 0.02 : 0.1;
    const platformFeeCents = Math.round(amount_cents * rate);

    const intentParams = {
      amount: amount_cents,
      currency: currency ?? 'usd',
      metadata: { listing_id, buyer_id: req.user.id, platform_fee_cents: platformFeeCents },
    };

    const sellerAccount = seller_stripe_account || seller?.stripe_account_id;
    if (sellerAccount) {
      intentParams.application_fee_amount = platformFeeCents;
      intentParams.transfer_data = { destination: sellerAccount };
    }

    const paymentIntent = await stripe.paymentIntents.create(intentParams);
    res.json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      platform_fee_cents: platformFeeCents,
    });
  } catch (err) {
    console.error('create-intent error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// PAYMENT CONFIRM
// ============================================
app.post('/payment/confirm', requireAuth, async (req, res) => {
  try {
    const { payment_intent_id, listing_id } = req.body;

    const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    if (paymentIntent.status !== 'succeeded') {
      return res
        .status(400)
        .json({ error: `Payment incomplete. Status: ${paymentIntent.status}` });
    }

    const { data: existing } = await supabase
      .from('transactions')
      .select('id')
      .eq('stripe_payment_intent_id', payment_intent_id)
      .single();
    if (existing)
      return res.json({ transaction_id: existing.id, already_processed: true });

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
        seller_amount: sellerAmount,
        stripe_payment_intent_id: payment_intent_id,
        escrow_status: 'holding',
        delivery_status: 'pending',
      })
      .select()
      .single();

    if (txError) throw txError;

    const downloadToken = generateSecureToken();
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    await supabase
      .from('transactions')
      .update({
        download_token: downloadToken,
        download_token_expires_at: tokenExpiry,
        delivery_status: 'delivered',
      })
      .eq('id', transaction.id);

    await supabase.rpc('increment_user_stat', {
      p_user_id: listing.seller_id,
      p_field: 'total_earned',
      p_amount: sellerAmount,
    });
    await supabase.rpc('increment_user_stat', {
      p_user_id: req.user.id,
      p_field: 'total_spent',
      p_amount: amount,
    });
    await supabase.rpc('increment_user_stat', {
      p_user_id: req.user.id,
      p_field: 'wins',
      p_amount: 1,
    });
    await supabase.rpc('award_buildx_score', {
      p_user_id: req.user.id,
      p_points: Math.round(amount * 2),
    });

    const certNumber = generateCertNumber();
    const { data: cert } = await supabase
      .from('certificates')
      .insert({
        certificate_number: certNumber,
        listing_id,
        transaction_id: transaction.id,
        buyer_id: req.user.id,
      })
      .select()
      .single();

    await supabase.from('vault').insert({
      owner_id: req.user.id,
      listing_id,
      transaction_id: transaction.id,
      certificate_id: cert.id,
    });

    await supabase
      .from('listings')
      .update({ status: 'sold', owner_id: req.user.id })
      .eq('id', listing_id);

    const { data: buyer } = await supabase
      .from('users')
      .select('email, username')
      .eq('id', req.user.id)
      .single();
    const { data: seller } = await supabase
      .from('users')
      .select('email')
      .eq('id', listing.seller_id)
      .single();

    await sendEmail({
      to: buyer.email,
      subject: `🎉 You won "${listing.title}"!`,
      html: `<h1>Congratulations!</h1><p>You won "${listing.title}" for ${amount} ${listing.currency}.</p>`,
    });
    await sendEmail({
      to: seller.email,
      subject: `💰 "${listing.title}" sold!`,
      html: `<h1>Sold!</h1><p>Your listing sold for ${amount} ${listing.currency}.</p>`,
    });
    await sendPushNotification(
      req.user.id,
      '🎉 You Won!',
      `You won "${listing.title}" for ${amount} ${listing.currency}`
    );
    await sendPushNotification(
      listing.seller_id,
      '💰 Item Sold!',
      `Your "${listing.title}" sold for ${amount} ${listing.currency}`
    );

    captureEvent('payment_confirmed', req.user.id, {
      listing_id,
      amount,
      transaction_id: transaction.id,
    });

    res.json({
      transaction_id: transaction.id,
      certificate_id: cert.id,
      download_token: downloadToken,
    });
  } catch (err) {
    console.error('confirm-payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// DOWNLOAD TOKEN
// ============================================
app.post('/download/generate-token', requireAuth, async (req, res) => {
  try {
    const { transaction_id } = req.body;
    const { data: tx } = await supabase
      .from('transactions')
      .select('buyer_id, listing_id')
      .eq('id', transaction_id)
      .single();
    if (!tx || tx.buyer_id !== req.user.id)
      return res.status(403).json({ error: 'Forbidden' });

    const token = generateSecureToken();
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await supabase
      .from('transactions')
      .update({ download_token: token, download_token_expires_at: expiry })
      .eq('id', transaction_id);

    const { data: listing } = await supabase
      .from('listings')
      .select('file_path')
      .eq('id', tx.listing_id)
      .single();
    const { data: signedUrl } = await supabase.storage
      .from('assets')
      .createSignedUrl(listing.file_path, 3600);

    res.json({ download_url: signedUrl, token, expires_at: expiry });
  } catch (err) {
    console.error('generate-token error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
  res.json({
    status: 'BUILD.X backend live 🚀',
    timestamp: new Date().toISOString(),
    features: {
      stripe_payment_sheet: true,
      subscriptions: { apex: true, legend: true, monthly: true, yearly: true },
      walletconnect_crypto: true,
      push_notifications: true,
      syndicate_rpc: true,
      voice_audio: true,
      escrow_release: true,
      cron_jobs: true,
      sentry: !!process.env.SENTRY_DSN && !!Sentry,
      posthog: !!process.env.POSTHOG_API_KEY && !!posthog,
    },
  });
});

// ============================================
// SENTRY ERROR HANDLER
// ============================================
if (Sentry && process.env.SENTRY_DSN && Sentry.Handlers) {
  app.use(Sentry.Handlers.errorHandler());
}

// ============================================
// CUSTOM ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT ?? 3000;
server.listen(PORT, () => {
  console.log(`\n👑 BUILD.X Backend (Complete) running on port ${PORT}\n`);
  console.log(`Features enabled:`);
  console.log(`  ✅ Stripe Payment Sheet`);
  console.log(`  ✅ Apex/Legend Subscriptions (Monthly/Yearly)`);
  console.log(`  ✅ WalletConnect Crypto Payments`);
  console.log(`  ✅ Expo Push Notifications`);
  console.log(`  ✅ Voice/Audio (WebSocket)`);
  console.log(`  ✅ Syndicate RPC`);
  console.log(`  ✅ Escrow Release`);
  console.log(`  ✅ Cron Jobs (Auctions, Dutch, Payments)`);
  if (process.env.SENTRY_DSN && Sentry) console.log(`  ✅ Sentry Error Tracking`);
  if (process.env.POSTHOG_API_KEY && posthog) console.log(`  ✅ PostHog Analytics`);
});

export default app;
