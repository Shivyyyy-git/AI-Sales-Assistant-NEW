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
from email_service import get_email_service
from gemini_audio_processor import GeminiAudioProcessor
import json

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


@app.route('/api/process-client-intake', methods=['POST'])
def process_client_intake():
    """
    Process client intake submission (simplified flow)
    1. Extract structured client info from initial input
    2. Check for missing required fields
    3. Generate follow-up questions if needed OR
    4. Generate recommendations and send email if complete
    """
    try:
        data = request.get_json() or {}
        initial_input = data.get('initialInput', '').strip()
        input_method = data.get('inputMethod', 'text')
        follow_up_answers = data.get('followUpAnswers', {})
        is_complete = data.get('complete', False)
        client_info_from_audio = data.get('clientInfo', {})

        if not initial_input and not client_info_from_audio:
            return jsonify({'error': 'No input provided'}), 400

        processor = GeminiAudioProcessor()
        
        # Combine initial input and follow-up answers
        full_text = initial_input
        if follow_up_answers:
            follow_up_text = '\n\n=== Follow-up Questions ===\n'
            for q, a in follow_up_answers.items():
                follow_up_text += f'Q: {q}\nA: {a}\n\n'
            full_text += follow_up_text

        # Extract structured client information
        try:
            client_data = processor.process_text_input(full_text)
        except Exception as e:
            print(f"[ERROR] Failed to extract client info: {e}")
            # Fallback: use info from audio if available
            client_data = client_info_from_audio

        # Required fields for recommendations
        required_fields = {
            'care_level': 'Type of care needed (Independent Living, Assisted Living, Memory Care)',
            'location_preference': 'Location preference (ZIP code or city/area)',
            'budget': 'Monthly budget range',
            'timeline': 'Timeline for moving (immediate, near-term, flexible)',
        }

        # Check which fields are missing
        missing_fields = []
        for field, description in required_fields.items():
            value = client_data.get(field) or client_data.get(field.replace('_', '_'))
            if not value or value == 'null':
                missing_fields.append(description)

        # If not complete, return follow-up questions
        if not is_complete and missing_fields:
            # Generate follow-up questions for missing fields
            follow_up_prompt = f"""Based on the client's initial input below, generate 2-3 specific, friendly follow-up questions to gather the missing information. 

Client's initial input:
{initial_input[:500]}

Missing information needed:
{', '.join(missing_fields[:3])}

Generate questions that are:
- Natural and conversational (not robotic)
- Easy to understand for older adults
- Specific to what's missing

Return ONLY a JSON array of question strings, like: ["Question 1", "Question 2", "Question 3"]
Do not include any other text or explanation."""

            try:
                from google import genai
                from google.genai import types
                client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
                response = client.models.generate_content(
                    model='gemini-2.0-flash-exp',
                    contents=follow_up_prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.3,
                        response_mime_type="application/json"
                    )
                )
                
                questions_text = response.text
                if questions_text.strip().startswith('```'):
                    questions_text = questions_text.strip().lstrip('```json').lstrip('```').rstrip('```').strip()
                
                questions = json.loads(questions_text)
                if not isinstance(questions, list):
                    questions = [questions] if isinstance(questions, str) else []
            except Exception as e:
                print(f"[ERROR] Failed to generate follow-up questions: {e}")
                # Fallback questions
                questions = [
                    f"What type of care is needed? ({', '.join([desc.split('(')[-1].rstrip(')') for desc in missing_fields[:1]])})",
                    "What's your preferred location or area of the city?",
                    "What's your monthly budget range for housing?"
                ]

            return jsonify({
                'followUpQuestions': questions[:3],  # Max 3 questions
                'clientInfo': client_data,
            })

        # Complete - generate recommendations and send email
        system = get_system()
        
        # Process the full transcript to get recommendations
        result = system.process_text_input(full_text)
        
        # Format recommendations for email
        recommendations = []
        if 'recommendations' in result and result['recommendations']:
            for rec in result['recommendations'][:10]:  # Top 10
                recommendations.append({
                    'name': rec.get('community_name', 'Unknown'),
                    'final_rank': rec.get('final_rank', 0),
                    'key_metrics': rec.get('key_metrics', {}),
                    'explanations': rec.get('explanations', {}),
                })

        # Prepare client info for email
        client_info = {
            'name': client_data.get('client_name') or 'Not provided',
            'budget': f"${client_data.get('budget', 0):,}/month" if client_data.get('budget') else 'Not specified',
            'location': client_data.get('location_preference') or 'Not specified',
            'care_level': client_data.get('care_level') or 'Not specified',
            'timeline': client_data.get('timeline') or 'Not specified',
            'special_needs': client_data.get('special_needs', {}).get('other') or 'None',
        }

        # Generate summary
        summary = {
            'care_type': client_info['care_level'],
            'location': client_info['location'],
            'budget_range': client_info['budget'],
            'urgency': client_info['timeline'],
            'total_recommendations': len(recommendations),
        }

        # Send email notification
        email_service = get_email_service()
        email_sent = email_service.send_intake_notification(
            transcript=full_text,
            client_info=client_info,
            recommendations=recommendations,
            summary=summary
        )

        # Also push to Google Sheets CRM
        try:
            crm_result = push_to_crm(result)
            crm_pushed = True
            consultation_id = crm_result.get('consultation_id')
        except Exception as exc:
            print(f"[WARNING] CRM push failed: {exc}")
            crm_pushed = False
            consultation_id = None

        return jsonify({
            'success': True,
            'clientInfo': client_info,
            'recommendations': recommendations,
            'summary': summary,
            'emailSent': email_sent,
            'crmPushed': crm_pushed,
            'consultationId': consultation_id,
        })

    except Exception as e:
        print(f"[ERROR] Client intake processing failed: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': f'Failed to process intake: {str(e)}'
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
