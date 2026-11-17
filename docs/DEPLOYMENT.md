# OpenEase Deployment Guide

This guide covers deployment strategies for OpenEase across cloud platforms, Docker containers, and self-hosted Linux/Windows virtual machines using a **pure PostgreSQL architecture**.

---

## 1. Quick Cloud Deployment (Render / Railway / Supabase / Neon)

OpenEase supports **Hybrid PostgreSQL Persistence**:
- **Zero-Config Embedded Mode (Default)**: Uses in-process WebAssembly PostgreSQL (`@electric-sql/pglite`) writing to disk in `./data/pglite`. No separate database server required.
- **Production External PostgreSQL Pool**: Automatically activates when `DATABASE_URL` or standard PostgreSQL environment variables are configured.

### Deploy to Render (Blueprint - 1-Click Automated)
1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New + -> Blueprint**.
3. Connect your repository (`https://github.com/utpalraj78-source/OpenEase`).
4. Render reads `render.yaml`, automatically provisions the **Web Service** and **Free Managed PostgreSQL**, injects `DATABASE_URL` and `SESSION_SECRET`, runs the seed script, and deploys live!

### Alternative: Deploy to Render Manually
1. In [Render Dashboard](https://dashboard.render.com), click **New + -> Web Service**.
2. Connect your repository (`utpalraj78-source/OpenEase`) and configure:
   - **Root Directory**: `.` (leave default / repo root)
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run seed`
   - **Start Command**: `npm start`
3. Under **Environment Variables**, add:
   - `DATABASE_URL`: *(Your cloud PostgreSQL URL, or leave blank to use embedded PGlite)*
   - `SESSION_SECRET`: *(A random 64-char string, e.g. `openssl rand -hex 32`)*
   - `PORT`: `3000`
   - `NODE_ENV`: `production`
4. Click **Deploy Web Service**.

### Deploy to Railway
1. Go to [railway.app](https://railway.app) and create a new project.
2. Click **New -> Database -> Add PostgreSQL**.
3. Click **New -> GitHub Repo** and select `utpalraj78-source/OpenEase`.
4. Railway will automatically link `DATABASE_URL` from the PostgreSQL service to OpenEase and deploy via the [Procfile](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/Procfile).

### Option B: Free Cloud PostgreSQL (Supabase / Neon)
1. Create a free PostgreSQL database at [supabase.com](https://supabase.com) or [neon.tech](https://neon.tech).
2. Copy your connection string:
   ```env
   DATABASE_URL=postgres://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
   ```
3. Set `DATABASE_URL` on Render, Railway, or VPS.

---

## 2. Docker & Docker-Compose Deployment

OpenEase includes a production [Dockerfile](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/Dockerfile) and [docker-compose.yml](file:///c:/Users/Utpal/Downloads/openease%20(1)/openease/docker-compose.yml) configured for PostgreSQL.

### Start Containers:
```bash
docker-compose up -d --build
```

### Seed Demo Data Inside Container:
```bash
docker-compose exec web npm run seed
```

### View Status & Logs:
```bash
docker-compose ps
docker-compose logs -f web
```
The application will be live at `http://localhost:3000`.

---

## 3. Production Linux VPS (Ubuntu / Debian + Nginx + PM2)

### Step 1: Install Node.js, PostgreSQL (optional), and PM2
```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx git

# PM2 Process Manager
sudo npm install -g pm2
```

### Step 2: Clone & Configure OpenEase
```bash
git clone https://github.com/utpalraj78-source/OpenEase.git /var/www/openease
cd /var/www/openease
npm install --omit=dev
cp .env.example .env

# Edit .env with your SESSION_SECRET and optional DATABASE_URL
nano .env

# Seed initial database records
npm run seed
```

### Step 3: Run with PM2 Cluster
```bash
pm2 start server.js -i max --name openease
pm2 save
pm2 startup
```

### Step 4: Configure Nginx Reverse Proxy
Create `/etc/nginx/sites-available/openease`:
```nginx
server {
    listen 80;
    server_name openease.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/openease /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Step 5: Enable Free SSL (Certbot)
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d openease.yourdomain.com
```

---

## 4. Environment Variables Reference

| Variable | Description | Default (Local) | Production Example |
|---|---|---|---|
| `PORT` | Listening port for web server | `3000` | `3000` |
| `DATABASE_URL` | PostgreSQL connection URI | *(Empty - uses embedded PGlite)* | `postgres://user:pass@ep-cool-db.neon.tech/openease?sslmode=require` |
| `PGHOST` | Alternative host parameter | `127.0.0.1` | `aws-rds.amazonaws.com` |
| `PGPORT` | PostgreSQL port | `5432` | `5432` |
| `PGUSER` | Database user | `postgres` | `openease_admin` |
| `PGPASSWORD` | Database password | `postgres` | `SecureSecret123!` |
| `PGDATABASE` | Database name | `openease` | `openease_prod` |
| `SESSION_SECRET` | Secret key for signed session cookies | Fallback string | Cryptographic 64-char hex string |
| `NODE_ENV` | Runtime environment | `development` | `production` |
| `LDAP_HOST` | Host for institutional directory | `ldap://directory.lnmiit.ac.in` | `ldap://directory.lnmiit.ac.in` |
| `LDAP_PORT` | Port for institutional directory | `389` | `389` |
