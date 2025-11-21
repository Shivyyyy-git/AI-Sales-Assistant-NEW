"""
Google Sheets CRM Integration
Automatically pushes recommendation data to Google Sheets for CRM workflow
"""

import gspread
from google.oauth2.service_account import Credentials
from datetime import datetime
from typing import Dict, Any, Optional
import os
from dotenv import load_dotenv

load_dotenv()


class GoogleSheetsCRM:
    """
    Integration with Google Sheets for CRM functionality
    Pushes consultation data, recommendations, and performance metrics
    """

    def __init__(self, spreadsheet_id: Optional[str] = None, service_account_file: Optional[str] = None):
        """
        Initialize Google Sheets CRM integration

        Args:
            spreadsheet_id: Google Spreadsheet ID (from URL)
            service_account_file: Path to service account JSON file
        """
        # Get configuration from environment or parameters
        self.spreadsheet_id = spreadsheet_id or os.getenv('GOOGLE_SPREADSHEET_ID')
        self.service_account_file = service_account_file or os.getenv(
            'GOOGLE_SERVICE_ACCOUNT_FILE',
            'gen-lang-client-0663556503-72ee52ed113f.json'
        )

        if not self.spreadsheet_id:
            raise ValueError(
                "GOOGLE_SPREADSHEET_ID not set. "
                "Either pass it as parameter or set in .env file"
            )

        # Set up credentials and authenticate
        self.scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]

        self.creds = Credentials.from_service_account_file(
            self.service_account_file,
            scopes=self.scopes
        )

        self.client = gspread.authorize(self.creds)
        self.spreadsheet = self.client.open_by_key(self.spreadsheet_id)

        print(f"[OK] Connected to Google Sheets: {self.spreadsheet.title}")

    def push_consultation(self, result: Dict[str, Any]) -> Dict[str, int]:
        """
        Push complete consultation data to all 3 sheets

        Args:
            result: The result dict from RankingBasedRecommendationSystem

        Returns:
            Dict with row numbers for each sheet
        """
        client_info = result.get('client_info', {})
        recommendations = result.get('recommendations', [])
        metrics = result.get('performance_metrics', {})

        # Get next consultation ID
        consultations_sheet = self.spreadsheet.worksheet('Client Consultations')
        consultation_id = len(consultations_sheet.get_all_values())  # Includes header

        print(f"\n[PUSHING] Consultation #{consultation_id} to Google Sheets...")

        # Push to each sheet
        row_numbers = {}
        row_numbers['consultation'] = self._push_to_consultations(consultation_id, client_info, recommendations, metrics)
        row_numbers['recommendations'] = self._push_to_recommendations(consultation_id, client_info, recommendations)
        row_numbers['performance'] = self._push_to_performance(consultation_id, metrics)

        print(f"[OK] Successfully pushed consultation #{consultation_id} to all sheets")

        return {
            'consultation_id': consultation_id,
            'rows_added': row_numbers
        }

    def _push_to_consultations(self, consultation_id: int, client_info: Dict,
                               recommendations: list, metrics: Dict) -> int:
        """Push to Sheet 1: Client Consultations"""
        sheet = self.spreadsheet.worksheet('Client Consultations')

        # Get top recommendation
        top_rec = recommendations[0] if recommendations else {}
        top_metrics = top_rec.get('key_metrics', {})
        top_explanations = top_rec.get('explanations', {})

        # Extract special needs
        special_needs = client_info.get('special_needs', {})
        special_needs_text = []
        if special_needs.get('pets'):
            special_needs_text.append("Pets: Yes")
        if special_needs.get('apartment_type_preference'):
            special_needs_text.append(f"Apt Type: {special_needs['apartment_type_preference']}")
        if special_needs.get('other'):
            special_needs_text.append(special_needs['other'])

        # Prepare row data
        row = [
            consultation_id,
            datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            client_info.get('client_name', ''),
            client_info.get('care_level', ''),
            f"${client_info.get('budget', 0):,.0f}" if client_info.get('budget') else '',
            client_info.get('timeline', ''),
            client_info.get('location_preference', ''),
            '; '.join(special_needs_text) if special_needs_text else '',
            len(recommendations),
            top_rec.get('community_id', ''),
            top_rec.get('community_name', ''),
            f"${top_metrics.get('monthly_fee', 0):,.0f}" if top_metrics.get('monthly_fee') else '',
            round(top_metrics.get('distance_miles', 0), 2) if top_metrics.get('distance_miles') else '',
            round(top_rec.get('combined_rank_score', 0), 2) if top_rec.get('combined_rank_score') else '',
            top_explanations.get('holistic_reason', ''),
            round(metrics.get('timings', {}).get('e2e_total', 0), 2),
            f"${metrics.get('costs', {}).get('total_cost', 0):.6f}",
            'New',  # Status
            '',  # Assigned_To
            ''   # Notes
        ]

        # Append row
        sheet.append_row(row, value_input_option='USER_ENTERED')
        print(f"  [OK] Added to 'Client Consultations' (Row {consultation_id + 1})")

        return consultation_id + 1

    def _push_to_recommendations(self, consultation_id: int, client_info: Dict,
                                 recommendations: list) -> list:
        """Push to Sheet 2: Recommendations Detail"""
        sheet = self.spreadsheet.worksheet('Recommendations Detail')

        rows_added = []

        for rec in recommendations:
            metrics = rec.get('key_metrics', {})
            rankings = rec.get('rankings', {})
            explanations = rec.get('explanations', {})

            row = [
                consultation_id,
                client_info.get('client_name', ''),
                rec.get('final_rank', ''),
                rec.get('community_id', ''),
                rec.get('community_name', ''),
                f"${metrics.get('monthly_fee', 0):,.0f}" if metrics.get('monthly_fee') else '',
                round(metrics.get('distance_miles', 0), 2) if metrics.get('distance_miles') else '',
                metrics.get('est_waitlist', ''),
                round(rec.get('combined_rank_score', 0), 2) if rec.get('combined_rank_score') else '',
                rankings.get('business_rank', ''),
                rankings.get('total_cost_rank', ''),
                rankings.get('distance_rank', ''),
                rankings.get('availability_rank', ''),
                explanations.get('holistic_reason', ''),
                metrics.get('contract_rate', ''),
                metrics.get('work_with_placement', ''),
                '',  # Tour_Scheduled
                '',  # Tour_Status
                ''   # Client_Feedback
            ]

            sheet.append_row(row, value_input_option='USER_ENTERED')
            rows_added.append(len(sheet.get_all_values()))

        print(f"  [OK] Added {len(recommendations)} recommendations to 'Recommendations Detail'")

        return rows_added

    def _push_to_performance(self, consultation_id: int, metrics: Dict) -> int:
        """Push to Sheet 3: Performance Analytics"""
        sheet = self.spreadsheet.worksheet('Performance Analytics')

        timings = metrics.get('timings', {})
        tokens = metrics.get('token_counts', {})
        costs = metrics.get('costs', {})

        row = [
            datetime.now().strftime('%Y-%m-%d'),
            consultation_id,
            round(timings.get('e2e_total', 0), 2),
            tokens.get('extraction_input', 0),
            tokens.get('ranking_input', 0),
            tokens.get('total_output_tokens', 0),
            tokens.get('total_tokens', 0),
            metrics.get('api_calls', 0),
            f"${costs.get('audio_input_cost', 0):.6f}" if 'audio_input_cost' in costs else f"${costs.get('text_input_cost', 0):.6f}",
            f"${costs.get('text_input_cost', 0):.6f}",
            f"${costs.get('output_cost', 0):.6f}",
            f"${costs.get('total_cost', 0):.6f}",
            round(tokens.get('total_tokens', 0) / timings.get('e2e_total', 1), 0) if timings.get('e2e_total') else 0,
            '',  # Communities_Filtered (would need to add this to metrics)
            ''   # Communities_Ranked (would need to add this to metrics)
        ]

        sheet.append_row(row, value_input_option='USER_ENTERED')
        row_num = len(sheet.get_all_values())
        print(f"  [OK] Added performance data to 'Performance Analytics' (Row {row_num})")

        return row_num


def push_to_crm(result: Dict[str, Any],
                spreadsheet_id: Optional[str] = None,
                service_account_file: Optional[str] = None) -> Dict:
    """
    Convenience function to push results to Google Sheets CRM

    Args:
        result: Result dict from RankingBasedRecommendationSystem
        spreadsheet_id: Optional Google Spreadsheet ID
        service_account_file: Optional path to service account JSON

    Returns:
        Dict with consultation_id and row numbers

    Example:
        >>> result = system.process_audio_file("consultation.m4a")
        >>> push_to_crm(result)
        {'consultation_id': 42, 'rows_added': {...}}
    """
    crm = GoogleSheetsCRM(spreadsheet_id, service_account_file)
    return crm.push_consultation(result)


if __name__ == "__main__":
    # Test with sample data
    print("Google Sheets CRM Integration Test")
    print("=" * 80)

    # Check if credentials exist
    if not os.path.exists('gen-lang-client-0663556503-72ee52ed113f.json'):
        print("[ERROR] Service account file not found!")
        print("Please ensure 'gen-lang-client-0663556503-72ee52ed113f.json' exists")
        exit(1)

    if not os.getenv('GOOGLE_SPREADSHEET_ID'):
        print("[ERROR] GOOGLE_SPREADSHEET_ID not set in .env file!")
        print("Please add: GOOGLE_SPREADSHEET_ID=your_spreadsheet_id")
        exit(1)

    print("[OK] Credentials found")
    print("[OK] Ready to push data to Google Sheets")
    print("\nTo use:")
    print("  from google_sheets_integration import push_to_crm")
    print("  push_to_crm(result)")
