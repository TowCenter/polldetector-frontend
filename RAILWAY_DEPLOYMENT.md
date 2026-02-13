# Railway Deployment Guide

## Current Setup

### Backend Service (✅ Deployed)
- **URL**: https://pollfinder-production.up.railway.app
- **Service Name**: pollfinder
- **Configuration**: Uses `railway.json` (deploys from `api/` folder)
- **Environment Variables**:
  - `MONGODB_CONNECTION_STRING`: ✅ Set
  - `MONGODB_DATABASE`: ✅ Set
  - `FRONTEND_ORIGIN`: ✅ Set to `*`

### Frontend Service (⏳ To Deploy)

## Option 1: Deploy Frontend via Railway Dashboard (Recommended)

1. **Go to Railway Dashboard**:
   - Visit: https://railway.app/project/cbe2aa74-cba6-4b2d-beba-11ec3424b475

2. **Add New Service**:
   - Click "+ New" → "Empty Service"
   - Name it "pollfinder-frontend"

3. **Connect to GitHub** (if not already):
   - In the new service, click "Settings"
   - Under "Source", click "Connect Repo"
   - Select your GitHub repo: `aishichandra/pollfinder`
   - Set Root Directory to: `/` (leave empty or set to root)

4. **Configure Build Settings**:
   - Build Command: `npm install && npm run build`
   - Start Command: `npx vite preview --host 0.0.0.0 --port $PORT`
   - Or use the `nixpacks.toml` file (automatically detected)

5. **Set Environment Variables**:
   - Add variable: `VITE_API_BASE` = `https://pollfinder-production.up.railway.app`

6. **Deploy**:
   - Click "Deploy"
   - Wait for build to complete

7. **Get Frontend URL**:
   - In Settings → Networking → "Generate Domain"
   - Copy the domain (e.g., `pollfinder-frontend-production.up.railway.app`)

8. **Update Backend CORS**:
   - Go back to the backend service (pollfinder)
   - Update `FRONTEND_ORIGIN` variable to: `https://your-frontend-domain.up.railway.app`
   - Redeploy backend

## Option 2: Deploy Frontend via Railway CLI (if you can link to the service)

```bash
# This requires creating the service in dashboard first, then:
railway service
# Select the frontend service

# Set environment variable
railway variables --set VITE_API_BASE=https://pollfinder-production.up.railway.app

# Deploy
railway up
```

## Testing Production

Once both services are deployed:

1. Visit your frontend URL
2. Select date: 2025-10-19
3. Expand "No Match" group
4. Verify `temp_poll_id` values appear
5. Check browser DevTools → Network → verify API calls succeed

## Troubleshooting

- **CORS errors**: Update `FRONTEND_ORIGIN` in backend to match frontend domain
- **API not found**: Verify `VITE_API_BASE` is set correctly in frontend
- **Build fails**: Check Railway build logs for errors
