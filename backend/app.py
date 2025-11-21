import os
from datetime import datetime
from typing import Optional

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
CORS(app, resources={
    r"/api/*": {
        "origins": [
            "http://localhost:3000",  # Development
            "http://localhost:5173",  # Vite dev server
            os.getenv("FRONTEND_ORIGIN", "*")  # Production (will be set by Render)
        ],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

SUPPORTED_LANGUAGES = {'english', 'hindi', 'spanish'}
DATA_FILE = os.getenv('DATA_FILE', 'DataFile_students_OPTIMIZED.xlsx')

recommendation_system: Optional[RankingBasedRecommendationSystem] = None


def get_system() -> RankingBasedRecommendationSystem:
    global recommendation_system
    if recommendation_system is None:
        recommendation_system = RankingBasedRecommendationSystem(DATA_FILE)
    return recommendation_system


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

    if data.get('push_to_crm', True) and os.getenv('GOOGLE_SPREADSHEET_ID'):
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

    push_to_sheets = request.form.get('push_to_crm', 'true').lower() == 'true'
    if push_to_sheets and os.getenv('GOOGLE_SPREADSHEET_ID'):
        try:
            crm_result = push_to_crm(result)
            result['crm_pushed'] = True
            result['consultation_id'] = crm_result['consultation_id']
        except Exception as exc:
            result['crm_error'] = str(exc)

    result['language'] = language
    return jsonify(result)


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

        # Format the data to match what push_to_crm expects
        formatted_result = {
            'client_info': {
                'client_name': data.get('clientProfile', {}).get('name', 'Unknown'),
                'budget': data.get('clientProfile', {}).get('budget', 0),
                'location_preference': data.get('clientProfile', {}).get('location', ''),
                'care_level': data.get('clientProfile', {}).get('careLevel', ''),
                'timeline': data.get('clientProfile', {}).get('timeline', ''),
                'special_needs': {
                    'pets': False,  # Frontend doesn't provide this level of detail
                    'apartment_type_preference': '',
                    'other': data.get('clientProfile', {}).get('specificDemands', '')
                }
            },
            'recommendations': [],
            'performance_metrics': {
                'timings': {'e2e_total': 0},
                'costs': {'total_cost': 0}
            }
        }

        # Map recommendations from frontend format to backend format
        for rec in data.get('recommendations', []):
            formatted_result['recommendations'].append({
                'community_name': rec.get('name', ''),
                'final_rank': 0,  # Frontend doesn't provide ranking
                'community_id': '',  # Frontend doesn't provide this
                'key_metrics': {
                    'monthly_fee': rec.get('price', ''),
                    'distance_miles': 0  # Frontend doesn't provide this
                },
                'rankings': {},  # Empty for now
                'explanations': {
                    'holistic_reason': rec.get('reason', '')
                },
                'combined_rank_score': 0
            })

        # Push to Google Sheets
        crm_result = push_to_crm(formatted_result)

        return jsonify({
            'success': True,
            'consultation_id': crm_result['consultation_id'],
            'message': f'Successfully updated CRM with consultation #{crm_result["consultation_id"]}'
        })

    except Exception as e:
        print(f"CRM Update Error: {e}")
        return jsonify({'error': str(e)}), 500


# Mock email endpoints - disabled as per user request
@app.route('/api/send-email-client', methods=['POST'])
def send_email_client():
    return jsonify({'success': True, 'message': 'Email feature is currently disabled.'})


@app.route('/api/send-email-manager', methods=['POST'])
def send_email_manager():
    return jsonify({'success': True, 'message': 'Email feature is currently disabled.'})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050)
