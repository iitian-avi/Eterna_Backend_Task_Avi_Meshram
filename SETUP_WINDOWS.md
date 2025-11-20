# Quick Setup Guide for Windows

## Option 1: Install Redis & PostgreSQL (Recommended for Full Testing)

### Install Redis for Windows

**Using Chocolatey** (easiest):
```powershell
# Install Chocolatey first (if not installed)
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

# Install Redis
choco install redis-64 -y

# Start Redis
redis-server
```

**Manual Installation**:
1. Download Redis from: https://github.com/microsoftarchive/redis/releases
2. Extract to `C:\Redis`
3. Run `redis-server.exe`

### Install PostgreSQL for Windows

1. Download from: https://www.postgresql.org/download/windows/
2. Run installer (choose port 5432, remember password)
3. Add to PATH: `C:\Program Files\PostgreSQL\15\bin`
4. Create database:
   ```powershell
   psql -U postgres
   # Enter password
   CREATE DATABASE solana_dex_bot;
   \q
   ```

---

## Option 2: Use Docker (Simpler Alternative)

**Install Docker Desktop**:
1. Download: https://www.docker.com/products/docker-desktop/
2. Install and restart computer

**Start Redis & PostgreSQL**:
```powershell
# Start Redis
docker run -d -p 6379:6379 --name redis redis:alpine

# Start PostgreSQL
docker run -d -p 5432:5432 --name postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=solana_dex_bot postgres:15-alpine

# Verify running
docker ps
```

---

## Option 3: Mock Testing (No Dependencies - Quick Demo)

For quick testing without installing anything, I'll create a mock version that simulates the flow without Redis/PostgreSQL.

### Create `.env` file

```bash
# Copy .env.example to .env
cp .env.example .env
```

Edit `.env`:
```env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Solana Configuration (mock mode)
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_NETWORK=devnet

# Database (optional for mock mode)
DATABASE_URL=postgresql://localhost:5432/solana_dex_bot

# Redis (optional for mock mode)
REDIS_HOST=localhost
REDIS_PORT=6379

# Queue Configuration
QUEUE_CONCURRENCY=10
QUEUE_MAX_RETRIES=3
```

---

## Current Status Check

Let me check what you have installed...

**Node.js**: ✅ Installed (version 14.17.0)
**Redis**: ❌ Not installed
**PostgreSQL**: ❌ Not installed

---

## Recommended Next Steps

**Choice A: Full Installation (30 minutes)**
- Install Redis & PostgreSQL using Docker or direct install
- Full functionality with persistence
- Best for development/production

**Choice B: Mock Testing (5 minutes)**
- I'll modify the code to work without Redis/PostgreSQL
- Simulates the flow in memory
- Great for quick demo and understanding the flow

**Which would you prefer?**

Type:
- "install" - I'll guide you through Docker installation
- "mock" - I'll create a mock version to test immediately
- "skip" - I'll show you the flow documentation without running
