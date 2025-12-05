"""
Script to share Google Spreadsheet with service account
"""
import gspread
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from pathlib import Path
import os

# Configuration
SPREADSHEET_ID = '1y3gAWKmK7wBOEZAPRistz1poyfvm9HFUMl1NzBaWQSY'
SERVICE_ACCOUNT_FILE = 'capstone-project-478823-fe31a45bfcf6.json'

def share_spreadsheet():
    """Share the spreadsheet with the service account"""
    backend_dir = Path(__file__).parent
    service_account_path = backend_dir / SERVICE_ACCOUNT_FILE
    
    if not service_account_path.exists():
        print(f"Error: Service account file not found: {service_account_path}")
        return False
    
    # Load service account email
    import json
    with open(service_account_path, 'r') as f:
        sa_data = json.load(f)
        sa_email = sa_data.get('client_email')
    
    print(f"Service Account Email: {sa_email}")
    print(f"Spreadsheet ID: {SPREADSHEET_ID}")
    print("\nAttempting to share spreadsheet...")
    
    try:
        # Set up credentials
        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        
        creds = Credentials.from_service_account_file(
            str(service_account_path),
            scopes=scopes
        )
        
        # Build Drive API service
        drive_service = build('drive', 'v3', credentials=creds)
        
        # Share the file with the service account
        permission = {
            'type': 'user',
            'role': 'writer',
            'emailAddress': sa_email
        }
        
        try:
            result = drive_service.permissions().create(
                fileId=SPREADSHEET_ID,
                body=permission,
                fields='id'
            ).execute()
            
            print(f"✅ Successfully shared spreadsheet with {sa_email}")
            print(f"Permission ID: {result.get('id')}")
            return True
            
        except Exception as e:
            error_msg = str(e)
            if 'already exists' in error_msg.lower() or 'duplicate' in error_msg.lower():
                print(f"✅ Spreadsheet is already shared with {sa_email}")
                return True
            elif 'not found' in error_msg.lower():
                print(f"❌ Error: Spreadsheet not found or you don't have permission to share it.")
                print(f"   Please share it manually:")
                print(f"   1. Open: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit")
                print(f"   2. Click 'Share' button")
                print(f"   3. Add: {sa_email}")
                print(f"   4. Give 'Editor' access")
                return False
            else:
                print(f"❌ Error sharing spreadsheet: {error_msg}")
                print(f"\nPlease share it manually:")
                print(f"1. Open: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit")
                print(f"2. Click 'Share' button")
                print(f"3. Add: {sa_email}")
                print(f"4. Give 'Editor' access")
                return False
                
    except Exception as e:
        print(f"❌ Error setting up credentials: {e}")
        print(f"\nPlease share the spreadsheet manually:")
        print(f"1. Open: https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit")
        print(f"2. Click 'Share' button")
        print(f"3. Add: {sa_email}")
        print(f"4. Give 'Editor' access")
        return False

if __name__ == '__main__':
    share_spreadsheet()


