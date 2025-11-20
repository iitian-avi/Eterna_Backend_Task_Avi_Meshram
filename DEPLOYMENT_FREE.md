# FREE Deployment Guide 🆓

This guide shows you how to deploy your Solana DEX Trading Bot **completely FREE** using free-tier services.

## 📋 Free Services We'll Use

| Service | What For | Free Tier |
|---------|----------|-----------|
| **Render.com** | Web hosting + PostgreSQL | 512 MB RAM, 1GB DB |
| **Upstash.com** | Redis (queue & cache) | 10,000 commands/day |
| **Solana** | RPC endpoint | Free public endpoint |

**Total Cost: $0/month** ✅

---

## 🚀 Step-by-Step Free Deployment

### Step 1: Get Free Redis from Upstash

1. Go to https://upstash.com
2. Sign up with GitHub (free)
3. Click "Create Database" → Choose "Global" (free tier)
4. **Copy these values** (you'll need them):
   ```
   REDIS_HOST: <your-database>.upstash.io
   REDIS_PORT: 6379
   REDIS_PASSWORD: <your-password>
   ```

### Step 2: Deploy to Render.com (Free Tier)

1. **Go to**: https://render.com
2. **Sign in** with GitHub
3. **Create New** → "Web Service"
4. **Connect Repository**: `iitian-avi/Eterna_Backend_Task_Avi_Meshram`
5. **Configure**:
   ```
   Name: solana-dex-bot
   Region: Oregon
   Branch: main
   Root Directory: (leave blank)
   Build Command: npm install && npm run build
   Start Command: node dist/index.js
   Plan: FREE
   ```

6. **Add Environment Variables**:
   Click "Advanced" → Add these:
   ```
   NODE_ENV=production
   PORT=10000
   HOST=0.0.0.0
   
   # Redis from Upstash (Step 1)
   REDIS_HOST=<your-upstash-host>
   REDIS_PORT=6379
   REDIS_PASSWORD=<your-upstash-password>
   
   # Solana (Free public RPC)
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
   
   # PostgreSQL (auto-filled by Render)
   POSTGRES_HOST=(auto)
   POSTGRES_PORT=(auto)
   POSTGRES_DB=(auto)
   POSTGRES_USER=(auto)
   POSTGRES_PASSWORD=(auto)
   
   # Performance (reduced for free tier)
   MAX_CONCURRENT_ORDERS=5
   MAX_ORDERS_PER_MINUTE=50
   MAX_RETRY_ATTEMPTS=3
   RETRY_BACKOFF_MS=1000
   ```

7. **Create Web Service** (wait 5-10 minutes)

### Step 3: Add Free PostgreSQL Database

1. In your Render dashboard, click "New +" → "PostgreSQL"
2. Configure:
   ```
   Name: solana-dex-db
   Database: solana_dex_bot
   User: (auto-generated)
   Region: Oregon (same as web service)
   Plan: FREE
   ```
3. Click "Create Database"
4. Wait 2-3 minutes for provisioning
5. Render will automatically connect it to your web service

### Step 4: Run Database Migrations

Once deployed, open the Render Shell and run:
```bash
# In Render dashboard: Your service → "Shell" tab
node -e "require('./dist/db/schema').initDatabase()"
```

Or create the tables manually:
```sql
-- Connect to your Render PostgreSQL and run:
-- (Copy SQL from src/db/schema.sql)
```

---

## ✅ Verification

Once deployed, test your API:

```bash
# Health check
curl https://your-app.onrender.com/health

# Create order
curl -X POST https://your-app.onrender.com/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "type": "MARKET",
    "side": "BUY",
    "inputToken": "So11111111111111111111111111111111111111112",
    "outputToken": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "inputAmount": "1000000000",
    "slippageBps": 100
  }'
```

---

## ⚠️ Free Tier Limitations

| Limitation | Impact | Workaround |
|------------|--------|------------|
| **Spins down after 15 min** | First request takes 30-60s | Upgrade to $7/mo or accept delay |
| **512 MB RAM** | Limited concurrent orders | Set MAX_CONCURRENT_ORDERS=5 |
| **1 GB Database** | ~10,000 orders history | Periodically archive old orders |
| **Upstash 10K commands/day** | ~300 orders/day | Upgrade Upstash for more |

---

## 💰 When to Upgrade (Optional)

**Render Starter Plan ($7/month)**:
- ✅ Always on (no spin down)
- ✅ 512 MB RAM (same)
- ✅ Better for production

**Upstash Pay-as-you-go**:
- ✅ $0.20 per 100K commands
- ✅ ~$2-5/month for moderate use

---

## 🆓 Alternative: Railway.app

Railway gives **$5 free credit per month**:

1. Go to https://railway.app
2. Sign in with GitHub
3. "New Project" → "Deploy from GitHub repo"
4. Select `iitian-avi/Eterna_Backend_Task_Avi_Meshram`
5. Add PostgreSQL: "+ New" → "Database" → "Add PostgreSQL"
6. Add Redis: "+ New" → "Database" → "Add Redis"
7. Railway auto-connects everything ✅

**Estimated free tier usage**: ~$3-4/month (within $5 credit)

---

## 🆓 Alternative: Docker + Oracle Cloud Free Tier

**Oracle Cloud gives**:
- ✅ 2 VM instances (1GB RAM each) - FREE FOREVER
- ✅ 200GB storage - FREE FOREVER
- ✅ 10TB bandwidth/month - FREE

**Steps**:
1. Sign up: https://cloud.oracle.com/free
2. Create Ubuntu VM
3. Install Docker
4. Run: `docker-compose up -d`

---

## 📊 Comparison

| Platform | Setup Time | Reliability | Free Tier |
|----------|-----------|-------------|-----------|
| **Render.com + Upstash** | 15 min | ⭐⭐⭐⭐ | Best for demo |
| **Railway.app** | 10 min | ⭐⭐⭐⭐⭐ | $5 credit |
| **Oracle Cloud + Docker** | 60 min | ⭐⭐⭐⭐⭐ | Forever free |

---

## 🎯 My Recommendation for Interview

**Use Render.com (Free) + Upstash (Free)**:
- ✅ Easiest setup (15 minutes)
- ✅ Professional URL (your-app.onrender.com)
- ✅ SSL/HTTPS included
- ✅ Auto-deploys from GitHub
- ⚠️ Spins down after 15 min (just mention this in interview)

**Tell interviewer**: "Deployed on Render free tier for demo purposes. In production, would use Starter plan ($7/mo) to eliminate cold starts."

---

## 🆘 Need Help?

If deployment fails:
1. Check Render logs: Dashboard → Your service → "Logs"
2. Check Redis connection: Verify Upstash credentials
3. Check database: Ensure PostgreSQL is connected
4. Test locally first: `npm run dev`

Your app is ready to deploy for FREE! 🚀
