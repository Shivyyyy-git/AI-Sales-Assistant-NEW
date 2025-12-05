# How to Regenerate Service Account Key

## Step 1: Go to Google Cloud Console
1. Visit: https://console.cloud.google.com/
2. Select project: **capstone-project-478823**

## Step 2: Navigate to Service Accounts
1. Go to: **IAM & Admin** → **Service Accounts**
2. Find: **capstone-data@capstone-project-478823.iam.gserviceaccount.com**
3. Click on the service account name

## Step 3: Create New Key
1. Click on the **"Keys"** tab
2. Click **"Add Key"** → **"Create new key"**
3. Select **JSON** format
4. Click **"Create"**
5. The JSON file will download automatically

## Step 4: Replace the Old Key File
1. The downloaded file will have a name like: `capstone-project-478823-xxxxx.json`
2. Rename it to: `capstone-project-478823-fe31a45bfcf6.json`
3. Replace the existing file in: `/Users/shivamsharma/Desktop/AI Sales Assistant/backend/`
4. Or update the `.env` file with the new filename

## Step 5: Share the Spreadsheet
1. Open: https://docs.google.com/spreadsheets/d/1y3gAWKmK7wBOEZAPRistz1poyfvm9HFUMl1NzBaWQSY/edit
2. Click **"Share"** button (top right)
3. Add: **capstone-data@capstone-project-478823.iam.gserviceaccount.com**
4. Give **"Editor"** access
5. Click **"Send"**

## Step 6: Restart the Server
After replacing the key file, restart your Flask server.


