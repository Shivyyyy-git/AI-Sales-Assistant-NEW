import gspread
from google.oauth2.service_account import Credentials
import os

creds = Credentials.from_service_account_file(
    'capstone-project-478823-fe31a45bfcf6.json',
    scopes=['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
)

client = gspread.authorize(creds)
spreadsheet_id = '1y3gAWKmK7wBOEZAPRistz1poyfvm9HFUMl1NzBaWQSY'
spreadsheet = client.open_by_key(spreadsheet_id)

print(f"Spreadsheet: {spreadsheet.title}")
print(f"\nWorksheets:")
for ws in spreadsheet.worksheets():
    print(f"  - {ws.title}")

