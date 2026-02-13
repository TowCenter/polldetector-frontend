#!/bin/bash
# Update Railway backend CORS after frontend is deployed
#
# Usage: ./update-cors.sh <frontend-url>
# Example: ./update-cors.sh https://pollfinder-frontend-production.up.railway.app

if [ -z "$1" ]; then
  echo "Usage: $0 <frontend-url>"
  echo "Example: $0 https://pollfinder-frontend-production.up.railway.app"
  exit 1
fi

FRONTEND_URL="$1"

echo "Updating backend CORS to allow: $FRONTEND_URL"

# Switch to backend service
railway service pollfinder

# Update FRONTEND_ORIGIN variable
railway variables --set FRONTEND_ORIGIN="$FRONTEND_URL"

echo "✅ CORS updated! Backend will restart automatically."
echo ""
echo "Next steps:"
echo "1. Wait ~30 seconds for backend to restart"
echo "2. Visit your frontend: $FRONTEND_URL"
echo "3. Test the app and verify temp_poll_id appears"
