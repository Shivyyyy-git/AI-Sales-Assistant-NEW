import os
from datetime import datetime
from typing import Optional
from pathlib import Path

import pandas as pd
from flask import Flask, jsonify, request
from flask_cors import CORS
from werkzeug.utils import secure_filename
from dotenv import load_dotenv

from main_pipeline_ranking import RankingBasedRecommendationSystem
from google_sheets_integration import push_to_crm
from csv_processor import CSVProcessor

load_dotenv()

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = os.path.join(os.getcwd(), 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# CORS configuration for production
allowed_origins = [
    "http://localhost:3000",  # Development
    "http://localhost:5173",  # Vite dev server
    "https://ai-sales-assistant-frontend.onrender.com",  # Production frontend
]

# Add FRONTEND_ORIGIN env var if set and not already in list
frontend_origin = os.getenv("FRONTEND_ORIGIN")
if frontend_origin and frontend_origin not in allowed_origins:
    allowed_origins.append(frontend_origin)

CORS(app, 
     origins=allowed_origins,
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     allow_headers=["Content-Type", "Authorization"],
     supports_credentials=True,
     expose_headers=["Content-Type"])

# Global error handler to ensure all errors return JSON
@app.errorhandler(Exception)
def handle_exception(e):
    """Handle all exceptions and return JSON error responses"""
    print(f"[ERROR] Unhandled exception: {e}")
    import traceback
    traceback.print_exc()
    return jsonify({
        'error': f'Internal server error: {str(e)}'
    }), 500

SUPPORTED_LANGUAGES = {'english', 'hindi', 'spanish'}
DATA_FILE = os.getenv('DATA_FILE', 'DataFile_students_OPTIMIZED.xlsx')

# Validate data file exists on startup
if not Path(DATA_FILE).exists():
    print(f"[ERROR] Data file not found: {DATA_FILE}")
    print(f"[ERROR] Current working directory: {os.getcwd()}")
    print(f"[ERROR] Please ensure the data file exists before starting the server.")
    print(f"[ERROR] Expected path: {Path(DATA_FILE).absolute()}")
    # Don't exit immediately - allow health check to work, but log error
    print(f"[WARNING] Server will start but /api/communities and processing endpoints will fail until file is available.")

recommendation_system: Optional[RankingBasedRecommendationSystem] = None


def get_system() -> RankingBasedRecommendationSystem:
    global recommendation_system
    if recommendation_system is None:
        recommendation_system = RankingBasedRecommendationSystem(DATA_FILE)
    return recommendation_system


@app.route('/', methods=['GET'])
def root():
    return jsonify({
        "message": "AI Sales Assistant API is running",
        "status": "healthy",
        "version": "1.0",
        "endpoints": {
            "health": "/api/health",
            "communities": "/api/communities",
            "process_text": "/api/process-text",
            "process_audio": "/api/process-audio"
        }
    })


@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "gemini_configured": bool(os.getenv("GEMINI_API_KEY")),
        "data_file": DATA_FILE
    })


@app.route('/api/process-text', methods=['POST'])
def process_text():
    data = request.get_json() or {}
    text = data.get('text', '')
    language = data.get('language', 'english').lower()

    if not text:
        return jsonify({'error': 'Text is required'}), 400

    if language not in SUPPORTED_LANGUAGES:
        language = 'english'

    system = get_system()
    result = system.process_text_input(text)

    # Always push to CRM if enabled (using hardcoded spreadsheet)
    if data.get('push_to_crm', True):
        try:
            crm_result = push_to_crm(result)
            result['crm_pushed'] = True
            result['consultation_id'] = crm_result['consultation_id']
        except Exception as exc:
            result['crm_error'] = str(exc)

    result['language'] = language
    return jsonify(result)


@app.route('/api/process-audio', methods=['POST'])
def process_audio():
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'Audio file is required'}), 400

        file = request.files['audio']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        filename = secure_filename(file.filename)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        saved_name = f"{timestamp}_{filename}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], saved_name)
        file.save(filepath)

        language = request.form.get('language', 'english').lower()
        if language not in SUPPORTED_LANGUAGES:
            language = 'english'

        system = get_system()
        result = system.process_audio_file(filepath, language)

        # Always push to CRM if enabled (using hardcoded spreadsheet)
        push_to_sheets = request.form.get('push_to_crm', 'true').lower() == 'true'
        if push_to_sheets:
            try:
                crm_result = push_to_crm(result)
                result['crm_pushed'] = True
                result['consultation_id'] = crm_result['consultation_id']
            except Exception as exc:
                result['crm_error'] = str(exc)
                print(f"[WARNING] CRM push failed: {exc}")

        result['language'] = language
        return jsonify(result)
    
    except Exception as e:
        print(f"[ERROR] Audio processing failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': f'Failed to process audio: {str(e)}'
        }), 500


@app.route('/api/communities', methods=['GET'])
def list_communities():
    df = pd.read_excel(DATA_FILE)
    records = df.fillna('').to_dict('records')
    return jsonify({'total': len(records), 'communities': records})


@app.route('/api/communities', methods=['POST'])
def add_community():
    df = pd.read_excel(DATA_FILE)
    data = request.get_json() or {}

    new_id = int(df['CommunityID'].max() + 1)
    data['CommunityID'] = new_id

    df = pd.concat([df, pd.DataFrame([data])], ignore_index=True)
    df.to_excel(DATA_FILE, index=False)

    global recommendation_system
    recommendation_system = None

    return jsonify({'success': True, 'community_id': new_id})


@app.route('/api/communities/<int:community_id>', methods=['PUT'])
def update_community(community_id: int):
    df = pd.read_excel(DATA_FILE)
    data = request.get_json() or {}
    idx = df[df['CommunityID'] == community_id].index
    if idx.empty:
        return jsonify({'error': 'Community not found'}), 404

    for key, value in data.items():
        if key in df.columns and key != 'CommunityID':
            df.at[idx[0], key] = value

    df.to_excel(DATA_FILE, index=False)

    global recommendation_system
    recommendation_system = None

    return jsonify({'success': True})


@app.route('/api/communities/<int:community_id>', methods=['DELETE'])
def delete_community(community_id: int):
    df = pd.read_excel(DATA_FILE)
    new_df = df[df['CommunityID'] != community_id]
    if len(new_df) == len(df):
        return jsonify({'error': 'Community not found'}), 404

    new_df.to_excel(DATA_FILE, index=False)

    global recommendation_system
    recommendation_system = None

    return jsonify({'success': True})


# CSV Upload Endpoints
@app.route('/api/communities/csv-template', methods=['GET'])
def download_csv_template():
    """Download CSV template with sample data"""
    try:
        processor = CSVProcessor(DATA_FILE)
        csv_content = processor.generate_template_csv()

        response = app.response_class(
            csv_content,
            mimetype='text/csv',
            headers={
                'Content-Disposition': 'attachment; filename=community_template.csv'
            }
        )
        return response
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/communities/csv-validate', methods=['POST'])
def validate_csv_upload():
    """Validate CSV file before upload"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        if not file.filename.lower().endswith('.csv'):
            return jsonify({'success': False, 'error': 'File must be a CSV file'}), 400

        # Read file content
        csv_content = file.read().decode('utf-8')

        # Validate CSV
        processor = CSVProcessor(DATA_FILE)
        result = processor.process_csv_upload(csv_content)

        return jsonify(result)

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/communities/csv-upload', methods=['POST'])
def upload_csv_communities():
    """Upload and process CSV file to add communities"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        if not file.filename.lower().endswith('.csv'):
            return jsonify({'success': False, 'error': 'File must be a CSV file'}), 400

        # Read file content
        csv_content = file.read().decode('utf-8')

        # First validate
        processor = CSVProcessor(DATA_FILE)
        validation_result = processor.process_csv_upload(csv_content)

        if not validation_result['success']:
            return jsonify(validation_result), 400

        # Get column mapping from validation
        column_mapping = validation_result['columns_mapped']

        # Now upload
        upload_result = processor.append_to_excel(csv_content, column_mapping)

        if upload_result['success']:
            # Reset recommendation system cache
            global recommendation_system
            recommendation_system = None

            return jsonify(upload_result)
        else:
            return jsonify(upload_result), 500

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/update-crm', methods=['POST'])
def update_crm():
    """
    Updates the Google Sheet with the latest consultation data.
    """
    try:
        data = request.get_json() or {}

        # Validate required data
        client_profile = data.get('clientProfile', {})
        recommendations = data.get('recommendations', [])

        if not client_profile or not isinstance(client_profile, dict):
            return jsonify({
                'error': 'Missing or invalid client profile data. Please ensure client information is collected before pushing to CRM.'
            }), 400

        if not recommendations or not isinstance(recommendations, list) or len(recommendations) == 0:
            return jsonify({
                'error': 'Missing or invalid recommendations data. Please ensure recommendations are generated before pushing to CRM.'
            }), 400

        # Format the data to match what push_to_crm expects
        # Parse budget string (e.g., "$5000" or "$5,000") to number
        budget_str = client_profile.get('budget', '0')
        budget = 0
        if isinstance(budget_str, str):
            # Remove $ and commas, then convert to int
            budget = int(budget_str.replace('$', '').replace(',', '').strip() or '0')
        elif isinstance(budget_str, (int, float)):
            budget = int(budget_str)

        formatted_result = {
            'client_info': {
                'client_name': client_profile.get('name', 'Unknown'),
                'budget': budget,
                'location_preference': client_profile.get('location', ''),
                'care_level': client_profile.get('careLevel', ''),
                'timeline': client_profile.get('timeline', ''),
                'special_needs': {
                    'pets': False,  # Frontend doesn't provide this level of detail
                    'apartment_type_preference': '',
                    'other': client_profile.get('specificDemands', '')
                }
            },
            'recommendations': [],
            'performance_metrics': {
                'timings': {'e2e_total': 0},
                'costs': {'total_cost': 0}
            }
        }

        # Map recommendations from frontend format to backend format
        for i, rec in enumerate(recommendations):
            if not isinstance(rec, dict):
                continue

            # Parse price string to number
            price_str = rec.get('price', '0')
            monthly_fee = 0
            if isinstance(price_str, str):
                # Extract numeric value from strings like "$5200/month", "$5,200", "5200"
                import re
                # Remove $ and /month, then find digits
                clean_price = price_str.replace('$', '').replace('/month', '').replace('/mo', '').strip()
                # Find the first number (with optional commas)
                match = re.search(r'(\d+(?:,\d+)*)', clean_price)
                if match:
                    monthly_fee = int(match.group(1).replace(',', ''))
                else:
                    monthly_fee = 0
            elif isinstance(price_str, (int, float)):
                monthly_fee = int(price_str)

            # Use ranking data if available (for live calls), otherwise provide defaults
            final_rank = rec.get('final_rank', i + 1)
            combined_rank_score = rec.get('combined_rank_score', (i + 1) * 10)

            formatted_rec = {
                'community_name': rec.get('name', ''),
                'final_rank': final_rank,
                'community_id': rec.get('community_id', f'frontend_{i + 1}'),
                'key_metrics': {
                    'monthly_fee': monthly_fee,
                    'distance_miles': rec.get('key_metrics', {}).get('distance_miles', 0),
                    'est_waitlist': rec.get('key_metrics', {}).get('est_waitlist', 'Available'),
                    'care_level': rec.get('key_metrics', {}).get('care_level', rec.get('careLevels', [client_profile.get('careLevel', '')])[0] if rec.get('careLevels') else client_profile.get('careLevel', '')),
                    'zip_code': rec.get('key_metrics', {}).get('zip_code') or (''.join(filter(str.isdigit, rec.get('address', ''))) if rec.get('address') else None),
                },
                'rankings': rec.get('rankings', {}),
                'explanations': {
                    'holistic_reason': rec.get('reason', '') or rec.get('explanations', {}).get('holistic_reason', ''),
                    'business_reason': rec.get('explanations', {}).get('business_reason'),
                    'total_cost_reason': rec.get('explanations', {}).get('total_cost_reason'),
                    'distance_reason': rec.get('explanations', {}).get('distance_reason'),
                    'availability_reason': rec.get('explanations', {}).get('availability_reason'),
                    'budget_efficiency_reason': rec.get('explanations', {}).get('budget_efficiency_reason'),
                    'couple_reason': rec.get('explanations', {}).get('couple_reason'),
                    'amenity_reason': rec.get('explanations', {}).get('amenity_reason'),
                },
                'combined_rank_score': combined_rank_score
            }

            formatted_result['recommendations'].append(formatted_rec)

        # Validate that we have recommendations to push
        if not formatted_result['recommendations']:
            return jsonify({
                'error': 'No valid recommendations found to push to CRM.'
            }), 400

        print(f"[CRM] Pushing {len(formatted_result['recommendations'])} recommendations for client: {formatted_result['client_info']['client_name']}")

        # Push to Google Sheets
        crm_result = push_to_crm(formatted_result)

        return jsonify({
            'success': True,
            'consultation_id': crm_result['consultation_id'],
            'message': f'Successfully updated CRM with consultation #{crm_result["consultation_id"]}'
        })

    except Exception as e:
        print(f"CRM Update Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': f'Failed to update CRM: {str(e)}. Please check your Google Sheets configuration and try again.'
        }), 500


# Mock email endpoints - disabled as per user request
@app.route('/api/send-email-client', methods=['POST'])
def send_email_client():
    return jsonify({'success': True, 'message': 'Email feature is currently disabled.'})


@app.route('/api/send-email-manager', methods=['POST'])
def send_email_manager():
    return jsonify({'success': True, 'message': 'Email feature is currently disabled.'})


# ============================================
# CLIENT INTAKE ENDPOINTS (Neil's simplified flow)
# ============================================

@app.route('/api/analyze-intake', methods=['POST'])
def analyze_intake():
    """
    Analyze client intake transcript and return:
    - Structured profile (extracted fields)
    - Follow-up questions for missing required info
    """
    try:
        data = request.get_json() or {}
        transcript = data.get('transcript', '')
        
        if not transcript:
            return jsonify({'error': 'Transcript is required'}), 400
        
        # Use Gemini to analyze the transcript
        from google import genai
        from google.genai import types
        import json
        
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            return jsonify({'error': 'API key not configured'}), 500
        
        client = genai.Client(api_key=api_key)
        
        analysis_prompt = f"""Analyze this client intake transcript for a senior living placement service.

TRANSCRIPT:
{transcript}

Extract the following information and return as JSON:
{{
  "profile": {{
    "name": "string or null if not mentioned",
    "careLevel": "Independent Living | Assisted Living | Memory Care | null",
    "medicalConditions": "string describing conditions or null",
    "activitiesStruggling": "string describing activities or null",
    "apartmentType": "Studio | 1-Bedroom | 2-Bedroom | Patio Home | null",
    "locationPreference": "string describing area/neighborhood or null",
    "budget": "string like '$5000' or '$4000-6000' or null",
    "budgetFlexibility": "Firm | Flexible | null",
    "timeline": "Immediate | 1-3 months | 3-6 months | 6+ months | null",
    "mobilityNeeds": "string or null",
    "specialRequests": "string or null"
  }},
  "followUpQuestions": [
    {{
      "id": "fieldName",
      "question": "Natural question to ask",
      "field": "fieldName"
    }}
  ]
}}

RULES:
1. Only include follow-up questions for CRITICAL missing fields (name, careLevel, budget, timeline)
2. Maximum 4 follow-up questions
3. Make questions conversational and friendly
4. If careLevel is not clear, always ask about it
5. Return ONLY valid JSON, no markdown"""

        response = client.models.generate_content(
            model='gemini-2.0-flash-exp',
            contents=analysis_prompt,
            config=types.GenerateContentConfig(
                temperature=0.1,
                response_mime_type="application/json"
            )
        )
        
        result_text = response.text if hasattr(response, 'text') and response.text else '{}'
        
        # Clean markdown if present
        if result_text.strip().startswith('```'):
            result_text = result_text.strip()
            if result_text.startswith('```json'):
                result_text = result_text[7:]
            elif result_text.startswith('```'):
                result_text = result_text[3:]
            if result_text.endswith('```'):
                result_text = result_text[:-3]
            result_text = result_text.strip()
        
        parsed = json.loads(result_text)
        
        return jsonify({
            'success': True,
            'profile': parsed.get('profile', {}),
            'followUpQuestions': parsed.get('followUpQuestions', [])
        })
        
    except Exception as e:
        print(f"[ERROR] analyze-intake failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/submit-intake', methods=['POST'])
def submit_intake():
    """
    Submit completed client intake:
    - Push to Google Sheets CRM
    - Generate ranked recommendations
    - Send email notification to team
    """
    try:
        data = request.get_json() or {}
        
        submission_id = data.get('submissionId', f'INTAKE-{int(datetime.now().timestamp())}')
        transcript = data.get('transcript', '')
        profile = data.get('structuredProfile', {})
        follow_ups = data.get('followUpAnswers', [])
        team_email = data.get('teamEmail') or os.getenv('TEAM_NOTIFICATION_EMAIL')
        timestamp = data.get('timestamp', datetime.now().isoformat())
        
        print(f"[INTAKE] Processing submission {submission_id}")
        print(f"[INTAKE] Profile: {profile}")
        
        # Step 1: Generate recommendations using the ranking system
        recommendations = []
        try:
            system = get_system()
            
            # Convert profile to the format expected by the ranking system
            client_text = f"""
            Client Name: {profile.get('name', 'Unknown')}
            Care Level Needed: {profile.get('careLevel', 'Unknown')}
            Medical Conditions: {profile.get('medicalConditions', 'Not specified')}
            Activities Struggling With: {profile.get('activitiesStruggling', 'Not specified')}
            Apartment Type: {profile.get('apartmentType', 'Any')}
            Location Preference: {profile.get('locationPreference', 'Flexible')}
            Budget: {profile.get('budget', 'Not specified')}
            Budget Flexibility: {profile.get('budgetFlexibility', 'Unknown')}
            Timeline: {profile.get('timeline', 'Flexible')}
            Mobility Needs: {profile.get('mobilityNeeds', 'None specified')}
            Special Requests: {profile.get('specialRequests', 'None')}
            """
            
            result = system.process_text_input(client_text)
            recommendations = result.get('recommendations', [])[:5]  # Top 5
            print(f"[INTAKE] Generated {len(recommendations)} recommendations")
        except Exception as rec_error:
            print(f"[WARNING] Could not generate recommendations: {rec_error}")
        
        # Step 2: Push to Google Sheets CRM
        try:
            crm_data = {
                'client_info': {
                    'client_name': profile.get('name', 'Unknown'),
                    'budget': parse_budget(profile.get('budget', '0')),
                    'location_preference': profile.get('locationPreference', ''),
                    'care_level': profile.get('careLevel', ''),
                    'timeline': profile.get('timeline', ''),
                    'special_needs': {
                        'medical': profile.get('medicalConditions', ''),
                        'mobility': profile.get('mobilityNeeds', ''),
                        'other': profile.get('specialRequests', '')
                    },
                    'source': 'client-self-service-intake',
                    'submission_id': submission_id,
                },
                'recommendations': recommendations,
                'performance_metrics': {
                    'timings': {'e2e_total': 0},
                    'costs': {'total_cost': 0}
                }
            }
            
            crm_result = push_to_crm(crm_data)
            print(f"[INTAKE] Pushed to CRM: consultation #{crm_result.get('consultation_id')}")
        except Exception as crm_error:
            print(f"[WARNING] CRM push failed: {crm_error}")
        
        # Step 3: Send email notification (if configured)
        email_sent = False
        if team_email:
            try:
                email_sent = send_intake_email(
                    to_email=team_email,
                    submission_id=submission_id,
                    transcript=transcript,
                    profile=profile,
                    follow_ups=follow_ups,
                    recommendations=recommendations,
                    timestamp=timestamp
                )
            except Exception as email_error:
                print(f"[WARNING] Email notification failed: {email_error}")
        
        return jsonify({
            'success': True,
            'submissionId': submission_id,
            'recommendationsCount': len(recommendations),
            'emailSent': email_sent,
            'message': 'Intake submitted successfully'
        })
        
    except Exception as e:
        print(f"[ERROR] submit-intake failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


def parse_budget(budget_str):
    """Parse budget string to integer"""
    if not budget_str:
        return 0
    import re
    # Extract first number from string like "$5000" or "$4,000-6,000"
    match = re.search(r'[\d,]+', str(budget_str).replace(',', ''))
    if match:
        return int(match.group().replace(',', ''))
    return 0


def send_intake_email(to_email, submission_id, transcript, profile, follow_ups, recommendations, timestamp):
    """
    Send email notification to team with intake summary.
    Uses SendGrid if configured, otherwise logs to console.
    """
    sendgrid_api_key = os.getenv('SENDGRID_API_KEY')
    from_email = os.getenv('SENDGRID_FROM_EMAIL', 'noreply@seniorlivingadvisor.com')
    
    # Build email content
    subject = f"🏠 New Client Intake: {profile.get('name', 'Unknown')} [{submission_id}]"
    
    # Build recommendations section
    recs_text = ""
    if recommendations:
        recs_text = "\n\n📋 RECOMMENDED COMMUNITIES:\n" + "-" * 40 + "\n"
        for i, rec in enumerate(recommendations, 1):
            name = rec.get('community_name', rec.get('name', f'Community {i}'))
            fee = rec.get('key_metrics', {}).get('monthly_fee', 'N/A')
            reason = rec.get('explanations', {}).get('holistic_reason', rec.get('reason', 'Good match'))
            recs_text += f"\n{i}. {name}\n   💰 ${fee}/month\n   ✨ {reason}\n"
    
    # Build follow-up answers section
    followup_text = ""
    if follow_ups:
        followup_text = "\n\n❓ FOLLOW-UP ANSWERS:\n" + "-" * 40 + "\n"
        for fu in follow_ups:
            followup_text += f"\nQ: {fu.get('question', 'Unknown')}\nA: {fu.get('answer', 'No answer')}\n"
    
    email_body = f"""
================================================================================
                    NEW CLIENT INTAKE SUBMISSION
================================================================================

📅 Submitted: {timestamp}
🔖 Reference: {submission_id}

================================================================================
                         CLIENT PROFILE
================================================================================

👤 Name: {profile.get('name', 'Not provided')}
🏥 Care Level: {profile.get('careLevel', 'Not specified')}
💰 Budget: {profile.get('budget', 'Not specified')} ({profile.get('budgetFlexibility', 'flexibility unknown')})
📍 Location: {profile.get('locationPreference', 'Flexible')}
🗓️ Timeline: {profile.get('timeline', 'Not specified')}
🏠 Apartment Type: {profile.get('apartmentType', 'Not specified')}
🩺 Medical Conditions: {profile.get('medicalConditions', 'Not specified')}
♿ Mobility Needs: {profile.get('mobilityNeeds', 'None specified')}
📝 Special Requests: {profile.get('specialRequests', 'None')}
{followup_text}
{recs_text}

================================================================================
                         FULL TRANSCRIPT
================================================================================

{transcript}

================================================================================
                         ACTION REQUIRED
================================================================================

Please contact the client within 24 hours to:
1. Confirm the information above is correct
2. Discuss the recommended communities
3. Schedule tours if interested

================================================================================
"""
    
    if sendgrid_api_key:
        try:
            import sendgrid
            from sendgrid.helpers.mail import Mail
            
            sg = sendgrid.SendGridAPIClient(api_key=sendgrid_api_key)
            message = Mail(
                from_email=from_email,
                to_emails=to_email,
                subject=subject,
                plain_text_content=email_body
            )
            response = sg.send(message)
            print(f"[EMAIL] Sent to {to_email}, status: {response.status_code}")
            return True
        except Exception as e:
            print(f"[EMAIL] SendGrid error: {e}")
            # Fall through to logging
    
    # If no SendGrid, log the email content
    print("\n" + "=" * 60)
    print(f"[EMAIL] Would send to: {to_email}")
    print(f"[EMAIL] Subject: {subject}")
    print("[EMAIL] Body preview (first 500 chars):")
    print(email_body[:500] + "...")
    print("=" * 60 + "\n")
    
    return False


# Print startup info for debugging
import sys
print("=" * 60)
print("🚀 AI Sales Assistant Backend Starting...")
print(f"   Python version: {sys.version.split()[0]}")
print(f"   Data file: {DATA_FILE}")
print(f"   Data file exists: {Path(DATA_FILE).exists()}")
print(f"   CORS origins: {allowed_origins}")
print(f"   Total routes: {len(list(app.url_map.iter_rules()))}")
print("=" * 60)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050)
