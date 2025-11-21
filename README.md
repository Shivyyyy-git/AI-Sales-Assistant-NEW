# AI Sales Assistant (Single Interface)

## Overview
- **Frontend**: React + Vite (TypeScript) in `frontend/`
- **Backend**: Flask API in `backend/`
- **Single UI**: React app handles live conversations, audio uploads, text consultations, database management
- **Flask**: No UI, API-only for ranking pipeline, CRM integration, email, data storage

## Development Setup

### 1. Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env  # fill in Gemini + Google credentials
python app.py
```
Backend runs on http://localhost:5050

### 2. Frontend
```bash
cd frontend
npm install
npm run dev
```
Frontend runs on http://localhost:3000 and proxies API calls to the backend.

## Production Build
```bash
cd frontend
npm run build  # output in frontend/dist
```
Deploy the static build to any host (S3, Netlify, etc.) and point it to the hosted Flask API via `VITE_API_BASE_URL`.

## Environment Variables
- `GEMINI_API_KEY`
- `GOOGLE_SPREADSHEET_ID`
- `GOOGLE_SERVICE_ACCOUNT_FILE`
- `FRONTEND_ORIGIN` (for CORS)
- Frontend: `VITE_API_BASE_URL`, `VITE_GEMINI_API_KEY`

## Data Files
- `backend/DataFile_students_OPTIMIZED.xlsx`
- `backend/consultations_log.xlsx`

## TODO
- Port all remaining React UI components from the previous project
- Connect live conversation UI to direct Gemini streaming
- Hook audio upload + text processing UI to backend endpoints
