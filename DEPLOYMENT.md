# Deployment Guide

This guide covers multiple deployment options for the Solana DEX Trading Bot.

## 🚀 Quick Deploy Options

### Option 1: Render.com (Recommended - Free Tier Available)

**Why Render?**
- ✅ Free tier includes web service, PostgreSQL, and Redis
- ✅ Automatic deploys from GitHub
- ✅ Built-in SSL/TLS
- ✅ Easy environment variable management

**Steps:**

1. **Push code to GitHub** (Already done! ✅)
   ```
   https://github.com/iitian-avi/Eterna_Backend_Task_Avi_Meshram
   ```

2. **Sign up at Render.com**
   - Go to https://render.com
   - Sign up with your GitHub account

3. **Create a Blueprint**
   - Click "New +" → "Blueprint"
   - Connect your GitHub repository: `iitian-avi/Eterna_Backend_Task_Avi_Meshram`
   - Render will detect `render.yaml` and create all services

4. **Configure Environment Variables**
   - In the Render dashboard, add these secrets:
     ```
     SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
     SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
     ```
   - (PostgreSQL and Redis URLs are auto-configured)

5. **Deploy**
   - Click "Apply" to deploy all services
   - Wait 5-10 minutes for initial deployment
   - Your API will be live at: `https://your-service.onrender.com`

6. **Test Deployment**
   ```bash
   # Health check
   curl https://your-service.onrender.com/health
   
   # Create order
   curl -X POST https://your-service.onrender.com/api/orders/execute \
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

**Render.com Resources Created:**
- Web Service (Node.js app)
- PostgreSQL Database (Starter: 256MB RAM, 1GB storage)
- Redis Instance (Starter: 25MB storage)

**Estimated Cost:** $0/month (Free tier) or $7/month (Starter plan for better performance)

---

### Option 2: Railway.app (Alternative)

**Why Railway?**
- ✅ $5 free credit per month
- ✅ One-click PostgreSQL and Redis
- ✅ Automatic HTTPS
- ✅ Simple pricing ($0.000463/GB-hour)

**Steps:**

1. **Sign up at Railway.app**
   - Go to https://railway.app
   - Sign up with GitHub

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose `iitian-avi/Eterna_Backend_Task_Avi_Meshram`

3. **Add Services**
   - Click "+ New" → "Database" → "Add PostgreSQL"
   - Click "+ New" → "Database" → "Add Redis"

4. **Configure Environment Variables**
   Railway auto-detects and links databases. Add these manually:
   ```
   NODE_ENV=production
   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   SOLANA_WS_URL=wss://api.mainnet-beta.solana.com
   MAX_CONCURRENT_ORDERS=10
   MAX_ORDERS_PER_MINUTE=100
   ```

5. **Deploy**
   - Railway automatically builds and deploys
   - Get public URL from "Settings" → "Networking" → "Generate Domain"

**Estimated Cost:** ~$5-10/month (after free credit)

---

### Option 3: Docker + VPS (DigitalOcean, AWS, etc.)

**Why VPS?**
- ✅ Full control over infrastructure
- ✅ Cost-effective for high traffic
- ✅ Horizontal scaling

**Steps:**

1. **Provision VPS**
   ```bash
   # Example: DigitalOcean Droplet
   # Size: 2GB RAM, 1 vCPU ($12/month)
   ```

2. **Install Docker & Docker Compose**
   ```bash
   # On Ubuntu/Debian
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   
   sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
   sudo chmod +x /usr/local/bin/docker-compose
   ```

3. **Clone Repository**
   ```bash
   git clone https://github.com/iitian-avi/Eterna_Backend_Task_Avi_Meshram.git
   cd Eterna_Backend_Task_Avi_Meshram
   ```

4. **Configure Environment**
   ```bash
   cp .env.example .env
   nano .env  # Edit with your values
   ```

5. **Deploy with Docker Compose**
   ```bash
   docker-compose up -d
   ```

6. **Setup Nginx Reverse Proxy (Optional)**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;
       
       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

7. **Setup SSL with Let's Encrypt**
   ```bash
   sudo apt install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

**Estimated Cost:** $12-20/month (VPS + bandwidth)

---

### Option 4: Vercel (Frontend) + Render (Backend)

**Why Split?**
- ✅ Vercel excels at static frontends
- ✅ Render handles WebSocket and long-running processes
- ✅ Best performance for each component

**Steps:**

1. **Deploy Backend to Render** (see Option 1)

2. **Create Frontend Repository**
   ```bash
   # Create a new Next.js app
   npx create-next-app@latest solana-dex-frontend
   cd solana-dex-frontend
   ```

3. **Connect to Backend API**
   ```javascript
   // pages/api/proxy.js
   export default async function handler(req, res) {
     const response = await fetch('https://your-render-app.onrender.com/api/orders/execute', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify(req.body)
     });
     const data = await response.json();
     res.status(200).json(data);
   }
   ```

4. **Deploy Frontend to Vercel**
   ```bash
   npm install -g vercel
   vercel
   ```

---

## 🔒 Security Checklist

Before deploying to production:

- [ ] Change default PostgreSQL password in `docker-compose.yml`
- [ ] Use paid Solana RPC endpoint (not free tier)
- [ ] Set `NODE_ENV=production`
- [ ] Enable HTTPS/TLS for WebSocket
- [ ] Add rate limiting per API key
- [ ] Set up CORS whitelist
- [ ] Configure firewall rules
- [ ] Enable database backups
- [ ] Set up monitoring and alerts
- [ ] Add authentication middleware
- [ ] Rotate secrets regularly

---

## 📊 Monitoring

### Health Check Endpoint

All platforms will monitor: `GET /health`

Expected response:
```json
{
  "status": "ok",
  "timestamp": 1700000000000,
  "services": {
    "redis": "connected",
    "postgres": "connected",
    "queue": "active"
  }
}
```

### Logging

**View logs on Render:**
```bash
# In Render dashboard: Logs tab
# Or use CLI:
render logs -s your-service-name
```

**View logs on Railway:**
```bash
# In Railway dashboard: View logs button
# Or use CLI:
railway logs
```

**View Docker logs:**
```bash
docker-compose logs -f app
docker-compose logs -f redis
docker-compose logs -f postgres
```

### Metrics to Monitor

| Metric | Threshold | Action |
|--------|-----------|--------|
| Order Queue Length | > 100 | Scale workers |
| Response Time | > 500ms | Check RPC latency |
| Error Rate | > 5% | Investigate logs |
| Memory Usage | > 80% | Upgrade plan |
| Redis Memory | > 90% | Increase maxmemory |

---

## 🔄 CI/CD Setup

### GitHub Actions (Automatic Deployment)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Render

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Deploy to Render
        env:
          RENDER_API_KEY: ${{ secrets.RENDER_API_KEY }}
        run: |
          curl -X POST https://api.render.com/v1/services/${{ secrets.RENDER_SERVICE_ID }}/deploys \
            -H "Authorization: Bearer $RENDER_API_KEY"
```

---

## 🚨 Troubleshooting

### Issue: WebSocket connection fails

**Solution:**
```bash
# Check if WebSocket is enabled on your platform
# Render: Automatic
# Railway: Automatic
# Vercel: Not supported (use Render for backend)
```

### Issue: Database connection timeout

**Solution:**
```bash
# Check if database is in same region as app
# Check connection pool settings
# Verify environment variables
```

### Issue: High memory usage

**Solution:**
```bash
# Reduce MAX_CONCURRENT_ORDERS
# Enable Redis maxmemory policy
# Implement pagination for large queries
```

---

## 📞 Support

**Deployed URL:** Will be available after deployment

**Dashboard Links:**
- Render: https://dashboard.render.com
- Railway: https://railway.app/dashboard
- Docker: http://localhost:3000/admin/queues

**Repository:** https://github.com/iitian-avi/Eterna_Backend_Task_Avi_Meshram

---

## 🎉 Next Steps After Deployment

1. ✅ Test all API endpoints
2. ✅ Connect WebSocket from frontend
3. ✅ Monitor queue dashboard
4. ✅ Set up alerts for failures
5. ✅ Document public API URL
6. ✅ Share with team/interviewer

**Your bot is now live and ready to handle orders! 🚀**
