# Pollfinder Deployment Guide

## 📦 What You Have

- **Frontend**: Svelte app (the website)
- **Backend**: Node.js API server (connects to MongoDB)

## 🚀 Deployment Steps

### Part 1: Deploy the API Server

#### Option A: Railway (Recommended - Free Tier)
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select the `api` folder
5. Add environment variables:
   - `MONGODB_CONNECTION_STRING` = `mongodb+srv://tow_pollfinder:7vjTHLrQZZxXzTHx@pollfinder.x6vlq6c.mongodb.net/`
   - `MONGODB_DATABASE` = `pollfinder`
   - `PORT` = `3001` (Railway will override this automatically)
6. Deploy! You'll get a URL like: `https://your-app.up.railway.app`

#### Option B: Heroku (Free Tier Available)
1. Install Heroku CLI: `brew install heroku/brew/heroku`
2. Login: `heroku login`
3. Create app: `heroku create your-app-name`
4. Set environment variables:
   ```bash
   heroku config:set MONGODB_CONNECTION_STRING="mongodb+srv://tow_pollfinder:7vjTHLrQZZxXzTHx@pollfinder.x6vlq6c.mongodb.net/"
   heroku config:set MONGODB_DATABASE="pollfinder"
   ```
5. Deploy:
   ```bash
   cd api
   git init
   git add .
   git commit -m "Initial commit"
   heroku git:remote -a your-app-name
   git push heroku main
   ```

#### Option C: Render (Free Tier)
1. Go to [render.com](https://render.com)
2. Click "New +" → "Web Service"
3. Connect your GitHub repo
4. Settings:
   - Root Directory: `api`
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Add environment variables in the dashboard
6. Deploy!

### Part 2: Update Frontend with API URL

1. After deploying the API, copy the URL (e.g., `https://your-app.railway.app`)
2. Update `.env.production`:
   ```bash
   VITE_API_URL=https://your-app.railway.app/api/polls
   ```
3. Build the frontend:
   ```bash
   npm run build
   ```
4. The `dist/` folder is ready to upload!

### Part 3: Deploy the Frontend

Upload the `dist/` folder to any static hosting:

- **GitHub Pages**: Push to gh-pages branch
- **Netlify**: Drag & drop the `dist` folder
- **Vercel**: Connect GitHub repo
- **Your own server**: Upload via FTP

## 🔧 Local Development

**Start API Server:**
```bash
cd api
node server.js
```

**Start Frontend:**
```bash
npm run dev
```

Visit: http://localhost:1573

## 📝 Environment Variables Summary

### API (.env in api folder)
- `MONGODB_CONNECTION_STRING` - MongoDB connection string
- `MONGODB_DATABASE` - Database name (pollfinder)
- `PORT` - Server port (defaults to 3001)

### Frontend
- `VITE_API_URL` - API endpoint URL
  - Local: `http://localhost:3001/api/polls`
  - Production: Your deployed API URL

## ⚠️ Security Notes

- **Never commit `.env` files** to git
- The MongoDB credentials are already in the code (consider rotating them after deployment)
- Update CORS settings in `server.js` to only allow your frontend domain in production

## 🆘 Troubleshooting

**Frontend shows "Failed to fetch":**
- Check if API server is running
- Verify CORS is configured correctly
- Check browser console for the exact error

**API returns empty data:**
- Verify MongoDB connection string
- Check query filters (date, num_polls_found, polls_mentioned)

**MongoDB connection fails:**
- Verify IP whitelist in MongoDB Atlas
- Check connection string credentials
