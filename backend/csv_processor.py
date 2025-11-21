"""
CSV Upload Processor for Community Database
Handles CSV file uploads and appends to Excel database
"""

import pandas as pd
import io
import csv
from typing import Dict, List, Any, Tuple, Optional
import os
from datetime import datetime

class CSVProcessor:
    """
    Processes CSV uploads for community database
    Handles validation, column mapping, and Excel appending
    """

    # Required columns (must be present and valid)
    REQUIRED_COLUMNS = {
        'community_name': ['Community Name', 'Community', 'Name', 'community_name'],
        'type_of_service': ['Type of Service', 'Type', 'Care Type', 'type_of_service'],
        'monthly_fee': ['Monthly Fee', 'Monthly', 'Fee', 'Price', 'monthly_fee'],
        'zip': ['ZIP', 'Zip', 'Zip Code', 'zip']
    }

    # Optional columns with defaults
    OPTIONAL_COLUMNS = {
        'deposit': (['Deposit', 'deposit'], 0),
        'move_in_fee': (['Move-In Fee', 'Move In Fee', 'move_in_fee'], 0),
        'second_person_fee': (['2nd Person Fee', 'Second Person Fee', 'second_person_fee'], 0),
        'pet_fee': (['Pet Fee', 'pet_fee'], 0),
        'enhanced': (['Enhanced', 'enhanced'], 'No'),
        'enriched': (['Enriched', 'enriched'], 'No'),
        'work_with_placement': (['Work with Placement?', 'Placement', 'work_with_placement'], 'No'),
        'contract_rate': (['Contract (w rate)?', 'Contract Rate', 'contract_rate'], ''),
        'apartment_type': (['Apartment Type', 'Unit Type', 'apartment_type'], ''),
        'est_waitlist_length': (['Est. Waitlist Length', 'Waitlist', 'Availability', 'est_waitlist_length'], 'Available')
    }

    def __init__(self, excel_file_path: str):
        self.excel_file_path = excel_file_path
        self.backup_path = f"{excel_file_path}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    def process_csv_upload(self, csv_content: str) -> Dict[str, Any]:
        """
        Process uploaded CSV content and return validation results

        Args:
            csv_content: Raw CSV file content as string

        Returns:
            Dict with validation results and preview data
        """
        try:
            # Parse CSV
            df_csv = pd.read_csv(io.StringIO(csv_content))

            if df_csv.empty:
                return {
                    'success': False,
                    'error': 'CSV file is empty'
                }

            # Validate columns
            column_mapping = self._map_columns(df_csv.columns.tolist())
            validation_result = self._validate_columns(column_mapping)

            if not validation_result['valid']:
                return {
                    'success': False,
                    'error': validation_result['error'],
                    'missing_columns': validation_result.get('missing_columns', []),
                    'invalid_columns': validation_result.get('invalid_columns', [])
                }

            # Validate data
            data_validation = self._validate_data(df_csv, column_mapping)

            if not data_validation['valid']:
                return {
                    'success': False,
                    'error': 'Data validation failed',
                    'validation_errors': data_validation['errors']
                }

            # Create preview
            preview_data = self._create_preview(df_csv, column_mapping)

            return {
                'success': True,
                'row_count': len(df_csv),
                'columns_mapped': column_mapping,
                'preview': preview_data[:5],  # Show first 5 rows
                'validation_warnings': data_validation.get('warnings', [])
            }

        except Exception as e:
            return {
                'success': False,
                'error': f'CSV processing failed: {str(e)}'
            }

    def append_to_excel(self, csv_content: str, column_mapping: Dict[str, str]) -> Dict[str, Any]:
        """
        Append validated CSV data to Excel file

        Args:
            csv_content: Raw CSV file content
            column_mapping: Validated column mapping

        Returns:
            Dict with append results
        """
        try:
            # Create backup
            if os.path.exists(self.excel_file_path):
                import shutil
                shutil.copy2(self.excel_file_path, self.backup_path)

            # Read existing Excel
            if os.path.exists(self.excel_file_path):
                df_excel = pd.read_excel(self.excel_file_path)
                next_id = df_excel['CommunityID'].max() + 1 if 'CommunityID' in df_excel.columns and not df_excel.empty else 1
            else:
                df_excel = pd.DataFrame()
                next_id = 1

            # Process CSV data
            df_csv = pd.read_csv(io.StringIO(csv_content))

            # Transform CSV to Excel format
            excel_rows = []
            for idx, row in df_csv.iterrows():
                excel_row = self._transform_row_to_excel(row, column_mapping, next_id + idx)
                excel_rows.append(excel_row)

            df_new = pd.DataFrame(excel_rows)

            # Append to existing data
            if not df_excel.empty:
                df_combined = pd.concat([df_excel, df_new], ignore_index=True)
            else:
                df_combined = df_new

            # Save to Excel
            df_combined.to_excel(self.excel_file_path, index=False)

            return {
                'success': True,
                'rows_added': len(df_new),
                'total_rows': len(df_combined),
                'id_range': f"{next_id}-{next_id + len(df_new) - 1}",
                'backup_created': self.backup_path
            }

        except Exception as e:
            # Restore backup if something went wrong
            if os.path.exists(self.backup_path):
                shutil.copy2(self.backup_path, self.excel_file_path)

            return {
                'success': False,
                'error': f'Failed to append to Excel: {str(e)}'
            }

    def generate_template_csv(self) -> str:
        """Generate a CSV template with sample data"""
        template_data = [
            ['Community Name', 'Type of Service', 'Monthly Fee', 'ZIP', 'Deposit', 'Move-In Fee', 'Enhanced', 'Enriched', 'Work with Placement?', 'Apartment Type', 'Est. Waitlist Length'],
            ['Sunset Gardens', 'Assisted Living', 5500, 14534, 2000, 1000, 'Yes', 'No', 'Yes', 'Studio', 'Available'],
            ['Oak Manor', 'Independent Living', 4200, 14535, 1500, 800, 'No', 'Yes', 'No', '1-Bedroom', 'Waitlist'],
            ['Pine Valley', 'Memory Care', 7200, 14536, 2500, 1200, 'Yes', 'Yes', 'Yes', '2-Bedroom', 'Immediate']
        ]

        output = io.StringIO()
        writer = csv.writer(output)
        for row in template_data:
            writer.writerow(row)

        return output.getvalue()

    def _map_columns(self, csv_columns: List[str]) -> Dict[str, str]:
        """Map CSV columns to expected system columns"""
        mapping = {}

        # Normalize CSV column names
        normalized_csv_cols = {col.lower().strip(): col for col in csv_columns}

        # Map required columns
        for system_col, possible_names in self.REQUIRED_COLUMNS.items():
            for possible_name in possible_names:
                if possible_name.lower() in normalized_csv_cols:
                    mapping[system_col] = normalized_csv_cols[possible_name.lower()]
                    break

        # Map optional columns
        for system_col, (possible_names, default) in self.OPTIONAL_COLUMNS.items():
            for possible_name in possible_names:
                if possible_name.lower() in normalized_csv_cols:
                    mapping[system_col] = normalized_csv_cols[possible_name.lower()]
                    break

        return mapping

    def _validate_columns(self, mapping: Dict[str, str]) -> Dict[str, Any]:
        """Validate that required columns are mapped"""
        missing_required = []
        for system_col in self.REQUIRED_COLUMNS.keys():
            if system_col not in mapping:
                missing_required.append(system_col)

        if missing_required:
            return {
                'valid': False,
                'error': f'Missing required columns: {", ".join(missing_required)}',
                'missing_columns': missing_required
            }

        return {'valid': True}

    def _validate_data(self, df: pd.DataFrame, mapping: Dict[str, str]) -> Dict[str, Any]:
        """Validate data types and formats"""
        errors = []
        warnings = []

        for idx, row in df.iterrows():
            row_num = idx + 2  # +2 because Excel rows start at 1 and have header

            # Validate Monthly Fee (required number)
            if 'monthly_fee' in mapping:
                fee_col = mapping['monthly_fee']
                if pd.notna(row[fee_col]):
                    try:
                        float(row[fee_col])
                    except (ValueError, TypeError):
                        errors.append(f'Row {row_num}: Monthly Fee must be a number, got "{row[fee_col]}"')

            # Validate ZIP (required 5-digit number)
            if 'zip' in mapping:
                zip_col = mapping['zip']
                if pd.notna(row[zip_col]):
                    zip_str = str(row[zip_col]).strip()
                    if not (zip_str.isdigit() and len(zip_str) == 5):
                        errors.append(f'Row {row_num}: ZIP must be 5 digits, got "{zip_str}"')

            # Validate numeric optional fields
            numeric_fields = ['deposit', 'move_in_fee', 'second_person_fee', 'pet_fee']
            for field in numeric_fields:
                if field in mapping and pd.notna(row[mapping[field]]):
                    try:
                        float(row[mapping[field]])
                    except (ValueError, TypeError):
                        warnings.append(f'Row {row_num}: {field.replace("_", " ").title()} should be a number, got "{row[mapping[field]]}"')

        return {
            'valid': len(errors) == 0,
            'errors': errors,
            'warnings': warnings
        }

    def _create_preview(self, df: pd.DataFrame, mapping: Dict[str, str]) -> List[Dict[str, Any]]:
        """Create preview data for UI"""
        preview = []

        for _, row in df.head(5).iterrows():
            preview_row = {}
            for system_col, csv_col in mapping.items():
                value = row[csv_col]
                if pd.notna(value):
                    # Format numbers nicely
                    if system_col in ['monthly_fee', 'deposit', 'move_in_fee', 'second_person_fee', 'pet_fee']:
                        try:
                            preview_row[system_col] = f"${float(value):,.0f}"
                        except:
                            preview_row[system_col] = str(value)
                    else:
                        preview_row[system_col] = str(value)
                else:
                    preview_row[system_col] = ''

            preview.append(preview_row)

        return preview

    def _transform_row_to_excel(self, csv_row: pd.Series, mapping: Dict[str, str], community_id: int) -> Dict[str, Any]:
        """Transform CSV row to Excel format"""
        excel_row = {'CommunityID': community_id}

        # Map required fields
        excel_row['Community Name'] = str(csv_row[mapping['community_name']]) if pd.notna(csv_row[mapping['community_name']]) else ''
        excel_row['Type of Service'] = str(csv_row[mapping['type_of_service']]) if pd.notna(csv_row[mapping['type_of_service']]) else ''
        excel_row['Monthly Fee'] = float(csv_row[mapping['monthly_fee']]) if pd.notna(csv_row[mapping['monthly_fee']]) else 0
        excel_row['ZIP'] = str(csv_row[mapping['zip']]) if pd.notna(csv_row[mapping['zip']]) else ''

        # Map optional fields with defaults
        for system_col, (possible_names, default) in self.OPTIONAL_COLUMNS.items():
            excel_col_name = self._system_to_excel_column(system_col)
            if system_col in mapping and pd.notna(csv_row[mapping[system_col]]):
                if system_col in ['deposit', 'move_in_fee', 'second_person_fee', 'pet_fee']:
                    try:
                        excel_row[excel_col_name] = float(csv_row[mapping[system_col]])
                    except:
                        excel_row[excel_col_name] = default
                else:
                    excel_row[excel_col_name] = str(csv_row[mapping[system_col]])
            else:
                excel_row[excel_col_name] = default

        return excel_row

    def _system_to_excel_column(self, system_col: str) -> str:
        """Convert system column name to Excel column name"""
        mapping = {
            'deposit': 'Deposit',
            'move_in_fee': 'Move-In Fee',
            'second_person_fee': '2nd Person Fee',
            'pet_fee': 'Pet Fee',
            'enhanced': 'Enhanced',
            'enriched': 'Enriched',
            'work_with_placement': 'Work with Placement?',
            'contract_rate': 'Contract (w rate)?',
            'apartment_type': 'Apartment Type',
            'est_waitlist_length': 'Est. Waitlist Length'
        }
        return mapping.get(system_col, system_col)
