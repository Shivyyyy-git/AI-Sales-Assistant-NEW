# AI Senior Living Placement Assistant

AI-powered client intake and community matching system for senior living placement consultants.

## Quick Start (Single Command)

```bash
./start.sh
```

This will:
1. Start the Flask API server (background)
2. Start the React frontend (port 3000)
3. Open your browser to `http://localhost:3000`

**Press Ctrl+C to stop both servers.**

---

## Features

- **Live Conversation**: Real-time AI consultation with automatic transcription
- **Audio Upload**: Process recorded consultations for client extraction
- **Text Input**: Paste transcripts for instant analysis
- **8-Dimensional Ranking**: Advanced community matching algorithm
- **Google Sheets Integration**: Automatic CRM logging
- **Database Management**: CRUD operations on community data
- **Email Templates**: Client and manager communication tools

---

## Manual Setup (First Time Only)

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend Setup
```bash
cd frontend
npm install
```

### Environment Variables

**Backend** (`backend/.env`):
```bash
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_SPREADSHEET_ID=1y3gAWKmK7wBOEZAPRistz1poyfvm9HFUMl1NzBaWQSY
GOOGLE_SERVICE_ACCOUNT_FILE=capstone-project-478823-fe31a45bfcf6.json
DATA_FILE=DataFile_students_OPTIMIZED.xlsx
FRONTEND_ORIGIN=http://localhost:3000
```

**Frontend** (`frontend/.env.local`):
```bash
VITE_API_BASE_URL=http://localhost:5050
VITE_GEMINI_API_KEY=your_gemini_api_key
```

---

## Manual Start (Alternative)

If you prefer to run servers separately:

**Terminal 1 - Backend:**
```bash
cd backend
source venv/bin/activate
python app.py
```

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Then open `http://localhost:3000`

---

## Architecture

- **Frontend (Port 3000)**: React + TypeScript + Vite + Tailwind CSS
- **Backend (Port 5050)**: Flask API (audio processing, ranking, Google Sheets)
- **Communication**: Frontend calls backend via `/api/*` endpoints

**Note:** Port 5050 is API-only and doesn't serve web pages. Users only interact with port 3000.

---

## Project Team

- Shivam Sharma, Ritwik Agrawal, Manu Jain, Yu Chen Lin (Ryan)
- **Faculty Advisor:** Professor Elizabeth Mohr
- **Client Partner:** Neil Russell, Culina Health

---

## Troubleshooting

**"Failed to fetch" error when pushing to Google Sheets:**
- Ensure both servers are running
- Check `frontend/.env.local` has `VITE_API_BASE_URL=http://localhost:5050`
- Restart frontend after changing `.env.local`

**Backend shows "Not Found" at localhost:5050:**
- This is normal! The backend is API-only
- Use `http://localhost:3000` for the UI

**Audio upload not working:**
- Verify `GEMINI_API_KEY` is set in `backend/.env`
- Check `backend.log` for errors
