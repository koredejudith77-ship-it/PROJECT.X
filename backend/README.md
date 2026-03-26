# BUILD.X - NFT Auction Platform (AWS-FREE)

## Features
- Live bidding auctions (standard, Dutch)
- Supabase Storage (no AWS required)
- Stripe payments + escrow
- Daily.co WebRTC voice rooms
- Syndicate group bidding
- Royalty engine (resales pay original creator)
- Daily drops + leaderboards

## Backend Setup (Railway/Render)
```
1. Clone repo
2. cd backend && npm install
3. Set env vars:
   STRIPE_SECRET_KEY=...
   SUPABASE_URL=...
   SUPABASE_SERVICE_KEY=... (service_role)
   DOWNLOAD_TOKEN_SECRET=...(48 random chars)
   CRON_SECRET=... (cron protection)
4. railway up (or Render deploy)
```

## Frontend Setup (Expo)
```
cd app && npm install
expo start
```

## Supabase Setup
1. Create project
2. Enable Storage buckets: `assets` (public), `previews` (public), `certificates` (public)
3. Run migrations (backend/run_migrations.js)
4. Add RPC functions (backend/Rpc functions.SQL)

## Test Backend
```
curl http://localhost:3000/health  # 👑 BUILD.X live
```

## Voice Setup (Daily.co)
1. daily.co → Create subdomain
2. Add `EXPO_PUBLIC_DAILY_API_KEY=...` to app env
3. Auction rooms auto-created

No AWS/S3 configuration needed!

