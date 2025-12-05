# Enable Required Google APIs

The service account needs the following APIs enabled in Google Cloud Console:

## Current Service Account
- **Email**: 838957737800-compute@developer.gserviceaccount.com
- **Project**: gen-lang-client-0000531506

## Required APIs to Enable

### 1. Google Sheets API
**URL**: https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=gen-lang-client-0000531506

1. Click the link above
2. Click **"Enable"** button
3. Wait a few minutes for it to propagate

### 2. Google Drive API
**URL**: https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=gen-lang-client-0000531506

1. Click the link above
2. Click **"Enable"** button
3. Wait a few minutes for it to propagate

## Share Spreadsheet

After enabling the APIs, share the spreadsheet with the service account:

1. Open: https://docs.google.com/spreadsheets/d/1y3gAWKmK7wBOEZAPRistz1poyfvm9HFUMl1NzBaWQSY/edit
2. Click **"Share"** button (top right)
3. Add: **838957737800-compute@developer.gserviceaccount.com**
4. Give **"Editor"** access
5. Click **"Send"**

## Alternative: Use Original Service Account

If you want to use the original service account (`capstone-data@capstone-project-478823.iam.gserviceaccount.com`):

1. Go to: https://console.cloud.google.com/iam-admin/serviceaccounts?project=capstone-project-478823
2. Find: `capstone-data@capstone-project-478823.iam.gserviceaccount.com`
3. Create a new key (JSON format)
4. Replace the current service account file

