"""
Enhanced Rule-Based Community Filtering Engine
Implements ALL heuristics from the PDF document with improvements
"""
import pandas as pd
from typing import Dict, List, Any, Optional
from dataclasses import dataclass
import math
from geocoding_utils import get_geocoder
from location_resolver import get_location_resolver


@dataclass
class ClientRequirements:
    """Structured client requirements extracted from audio/transcript"""
    care_level: str  # "Independent Living", "Assisted Living", "Memory Care"
    enhanced: bool
    enriched: bool
    budget: float
    timeline: str  # "immediate", "near-term", "flexible"
    location_preference: str  # ZIP code
    special_needs: Dict[str, Any]
    client_name: Optional[str] = None
    notes: Optional[str] = None


class EnhancedCommunityFilterEngine:
    """
    Enhanced rule-based filtering engine with all improvements:
    1. Hard Filters (with budget including fees)
    2. Priority Ranking (by business relationship)
    3. Geographic Proximity (improved distance calculation)
    4. Final Output (deduplicated by community, apartment type filtering)
    """

    def __init__(self, data_file_path: str, include_total_fees: bool = True):
        """
        Load the community data from Excel

        Args:
            data_file_path: Path to Excel file
            include_total_fees: If True, budget includes deposits and fees
        """
        self.df = pd.read_excel(data_file_path)
        self.include_total_fees = include_total_fees
        self.geocoder = get_geocoder()  # Initialize geocoder
        self.location_resolver = get_location_resolver()  # Initialize location resolver
        self._normalize_data()

    def _normalize_data(self):
        """Clean and normalize the data for consistent filtering"""
        # Convert Yes/No to boolean
        for col in ['Enhanced', 'Enriched', 'Work with Placement?']:
            if col in self.df.columns:
                self.df[col] = self.df[col].map({'Yes': True, 'No': False})

        # Ensure Monthly Fee is numeric
        if 'Monthly Fee' in self.df.columns:
            self.df['Monthly Fee'] = pd.to_numeric(
                self.df['Monthly Fee'].astype(str).str.replace(',', '').str.replace('$', ''),
                errors='coerce'
            )

        # Normalize fee columns
        for col in ['Deposit', 'Move-In Fee', '2nd Person Fee', 'Pet Fee']:
            if col in self.df.columns:
                self.df[col] = pd.to_numeric(
                    self.df[col].astype(str).str.replace(',', '').str.replace('$', ''),
                    errors='coerce'
                )
                self.df[col] = self.df[col].fillna(0)

        # Calculate total first month cost (IMPROVEMENT: Gap #3)
        if self.include_total_fees:
            self.df['Total First Month Cost'] = (
                self.df.get('Monthly Fee', 0) +
                self.df.get('Deposit', 0) +
                self.df.get('Move-In Fee', 0)
            )

        # Normalize ZIP codes
        if 'ZIP' in self.df.columns:
            self.df['ZIP'] = self.df['ZIP'].astype(str).str.strip()

        # Normalize Geocode for better distance calculation (IMPROVEMENT: Gap #4)
        if 'Geocode' in self.df.columns:
            self.df['Geocode'] = pd.to_numeric(self.df['Geocode'], errors='coerce')

    def filter_communities(self, client_req: ClientRequirements,
                          deduplicate: bool = True,
                          max_per_community: int = 3) -> pd.DataFrame:
        """
        Apply the complete 4-step filtering process with enhancements

        Args:
            client_req: Client requirements
            deduplicate: If True, limit results per community (IMPROVEMENT: Gap #7)
            max_per_community: Max apartment types to show per community

        Returns:
            Ranked DataFrame of matching communities
        """
        print("\n" + "="*80)
        print("APPLYING ENHANCED FILTERING HEURISTICS")
        print("="*80)

        # STEP 1: HARD FILTERS
        filtered_df = self._apply_hard_filters(client_req)

        if filtered_df.empty:
            print("\n[WARNING] No communities match the hard filter criteria")
            return filtered_df

        # STEP 2: PRIORITY RANKING
        filtered_df = self._apply_priority_ranking(filtered_df)

        # STEP 3: GEOGRAPHIC PROXIMITY
        filtered_df = self._apply_geographic_sorting(filtered_df, client_req.location_preference)

        # STEP 4: FINAL OUTPUT (with deduplication)
        return self._prepare_final_output(filtered_df, deduplicate, max_per_community)

    def _apply_hard_filters(self, client_req: ClientRequirements) -> pd.DataFrame:
        """
        STEP 1: HARD FILTERS - Eliminate non-matches
        """
        print("\n[STEP 1] APPLYING HARD FILTERS")
        print("-" * 80)

        df = self.df.copy()
        initial_count = len(df)

        # A. Care Level Assessment
        print(f"  A. Filtering by Care Level: {client_req.care_level}")
        df = df[df['Type of Service'] == client_req.care_level]
        print(f"     Remaining: {len(df)} / {initial_count}")

        # B. Enhanced/Enriched Services
        if client_req.enhanced:
            print(f"  B. Filtering by Enhanced Services: Required")
            df = df[df['Enhanced'] == True]
            print(f"     Remaining: {len(df)}")

        if client_req.enriched:
            print(f"  B. Filtering by Enriched Services: Required")
            df = df[df['Enriched'] == True]
            print(f"     Remaining: {len(df)}")

        # C. Timeline Urgency
        print(f"  C. Filtering by Timeline: {client_req.timeline}")
        df = self._filter_by_timeline(df, client_req.timeline)
        print(f"     Remaining: {len(df)}")

        # D. Budget Constraint (ENHANCED: includes total fees)
        budget_column = 'Total First Month Cost' if self.include_total_fees and 'Total First Month Cost' in df.columns else 'Monthly Fee'
        if client_req.budget is None:
            print("  D. Budget not provided - skipping budget filter")
        else:
            print(f"  D. Filtering by Budget: ${client_req.budget:,.2f}")
            print(f"     Using: {budget_column}")
            df = df[df[budget_column] <= client_req.budget]
            print(f"     Remaining: {len(df)}")

        # E. Apartment Type Preference (IMPROVEMENT: Gap #2)
        apt_pref = client_req.special_needs.get('apartment_type_preference')
        if apt_pref:
            print(f"  E. Filtering by Apartment Type: {apt_pref}")
            df = df[df['Apartment Type'].str.contains(apt_pref, case=False, na=False)]
            print(f"     Remaining: {len(df)}")

        # F. Pet-Friendly (IMPROVEMENT: Gap #1 - placeholder for future)
        # Note: DataFile_students.xlsx doesn't have Pet Friendly column yet
        if client_req.special_needs.get('pets') and 'Pet Friendly' in df.columns:
            print(f"  F. Filtering by Pet-Friendly: Required")
            df = df[df['Pet Friendly'] == True]
            print(f"     Remaining: {len(df)}")
        elif client_req.special_needs.get('pets'):
            print(f"  F. Pet-Friendly filter: [SKIPPED - data not available]")

        print(f"\n  HARD FILTER RESULT: {len(df)} options passed")
        return df

    def _filter_by_timeline(self, df: pd.DataFrame, timeline: str) -> pd.DataFrame:
        """Filter by availability based on timeline urgency"""
        if timeline == "immediate":
            # 0-1 months: Only "Available" or "Unconfirmed"
            return df[df['Est. Waitlist Length'].isin(['Available', 'Unconfirmed'])]

        elif timeline == "near-term":
            # 1-6 months: Include 7-12 months as well (IMPROVEMENT: Gap #6)
            allowed = ['Available', 'Unconfirmed', '1-2 months', '7-12 months']
            return df[df['Est. Waitlist Length'].isin(allowed)]

        else:  # flexible
            # 6+ months: Include all waitlist options
            return df

    def _apply_priority_ranking(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        STEP 2: PRIORITY RANKING SYSTEM
        Assign priority levels based on business relationships
        """
        print("\n[STEP 2] APPLYING PRIORITY RANKING")
        print("-" * 80)

        def get_priority(row):
            contract = row.get('Contract (w rate)?', 'No')
            placement = row.get('Work with Placement?', False)

            # Priority 1: Revenue-Generating Partners
            if pd.notna(contract) and contract != 'No' and contract != False:
                return 1

            # Priority 2: Placement Partners
            if placement == True:
                return 2

            # Priority 3: Non-Partners
            return 3

        df['Priority'] = df.apply(get_priority, axis=1)

        # Count by priority
        priority_counts = df['Priority'].value_counts().sort_index()
        print(f"  Priority 1 (Revenue Partners): {priority_counts.get(1, 0)} options")
        print(f"  Priority 2 (Placement Partners): {priority_counts.get(2, 0)} options")
        print(f"  Priority 3 (Non-Partners): {priority_counts.get(3, 0)} options")

        return df

    def _apply_geographic_sorting(self, df: pd.DataFrame, preferred_location: str) -> pd.DataFrame:
        """
        STEP 3: GEOGRAPHIC PROXIMITY RANKING
        Sort by distance within each priority level (IMPROVED: Real geocoding + location resolution)
        """
        print("\n[STEP 3] APPLYING GEOGRAPHIC SORTING")
        print("-" * 80)
        print(f"  Preferred Location: {preferred_location}")

        if preferred_location and preferred_location != "null":
            # Resolve location to ZIP code (handles both ZIPs and descriptions)
            resolved_zip = self.location_resolver.resolve_location(preferred_location)

            if resolved_zip:
                print(f"  Resolved to ZIP: {resolved_zip}")
                print("  Calculating real distances (may take a moment)...")

                # Calculate distances using real geocoding
                df['Distance'] = df['ZIP'].apply(
                    lambda x: self.geocoder.calculate_distance(str(x), str(resolved_zip))
                    if pd.notna(x) else 9999
                )
            else:
                print("  Could not resolve location, using placeholder distances")
                df['Distance'] = 9999
        else:
            print("  No preferred location specified, using placeholder distances")
            df['Distance'] = 9999

        # Sort by Priority (ascending) then Distance (ascending)
        df = df.sort_values(['Priority', 'Distance'])

        # Show distance stats
        if 'Distance' in df.columns:
            valid_distances = df[df['Distance'] < 9999]['Distance']
            if not valid_distances.empty:
                print(f"  Distance range: {valid_distances.min():.1f} - {valid_distances.max():.1f} miles")
                print(f"  Median distance: {valid_distances.median():.1f} miles")

        print(f"  Sorted {len(df)} options by priority and proximity")

        return df


    def _prepare_final_output(self, df: pd.DataFrame,
                             deduplicate: bool = True,
                             max_per_community: int = 3) -> pd.DataFrame:
        """
        STEP 4: FINAL OUTPUT FORMAT
        Clean up and prepare the final ranked list (IMPROVED: Gap #7)
        """
        print("\n[STEP 4] PREPARING FINAL OUTPUT")
        print("-" * 80)

        # Deduplicate by community if requested
        if deduplicate and 'CommunityID' in df.columns:
            print(f"  Deduplicating: Keeping top {max_per_community} options per community")
            df = df.groupby('CommunityID').head(max_per_community)

        # Select relevant columns for output
        output_columns = [
            'CommunityID',
            'Priority',
            'Type of Service',
            'ZIP',
            'Apartment Type',
            'Monthly Fee',
            'Est. Waitlist Length',
            'Work with Placement?',
            'Contract (w rate)?',
            'Distance'
        ]

        # Add total cost if available
        if 'Total First Month Cost' in df.columns:
            output_columns.insert(6, 'Total First Month Cost')

        # Keep only columns that exist
        output_columns = [col for col in output_columns if col in df.columns]

        result = df[output_columns].copy()

        # Count unique communities
        unique_communities = result['CommunityID'].nunique() if 'CommunityID' in result.columns else len(result)
        print(f"  Final ranked list: {len(result)} options from {unique_communities} communities")
        print("="*80)

        return result

    def get_recommendations_summary(self, ranked_df: pd.DataFrame, top_n: int = 5) -> str:
        """Generate a human-readable summary of top recommendations"""
        if ranked_df.empty:
            return "No communities match the client's requirements."

        summary = f"\nTOP {min(top_n, len(ranked_df))} RECOMMENDED OPTIONS:\n"
        summary += "="*80 + "\n"

        for i, (idx, row) in enumerate(ranked_df.head(top_n).iterrows(), 1):
            priority_label = {1: "Revenue Partner", 2: "Placement Partner", 3: "Non-Partner"}
            priority = priority_label.get(row['Priority'], 'Unknown')

            summary += f"\n{i}. [Priority {row['Priority']} - {priority}]\n"
            summary += f"   Community ID: {row.get('CommunityID', 'N/A')}\n"
            summary += f"   Type: {row.get('Type of Service', 'N/A')}\n"
            summary += f"   ZIP: {row.get('ZIP', 'N/A')}\n"
            summary += f"   Unit: {row.get('Apartment Type', 'N/A')}\n"
            summary += f"   Monthly Fee: ${row.get('Monthly Fee', 0):,.2f}\n"

            if 'Total First Month Cost' in row:
                summary += f"   First Month Total: ${row.get('Total First Month Cost', 0):,.2f}\n"

            summary += f"   Availability: {row.get('Est. Waitlist Length', 'N/A')}\n"
            summary += f"   Distance Score: {row.get('Distance', 'N/A')}\n"

        summary += "\n" + "="*80 + "\n"

        return summary


def test_enhanced_engine():
    """Test the enhanced filtering engine"""
    print("\n" + "="*80)
    print("TESTING ENHANCED COMMUNITY FILTER ENGINE")
    print("="*80)

    # Sample client requirements
    client = ClientRequirements(
        care_level="Assisted Living",
        enhanced=True,
        enriched=False,
        budget=7000.0,
        timeline="near-term",
        location_preference="14534",
        special_needs={
            "pets": True,
            "apartment_type_preference": "Studio",  # NEW: Apartment type filtering
            "other": "Needs diabetic care"
        },
        client_name="Test Client"
    )

    print("\nCLIENT REQUIREMENTS:")
    print(f"  Care Level: {client.care_level}")
    print(f"  Enhanced: {client.enhanced}")
    print(f"  Budget: ${client.budget:,.2f}")
    print(f"  Timeline: {client.timeline}")
    print(f"  Location: {client.location_preference}")
    print(f"  Apartment Preference: {client.special_needs.get('apartment_type_preference')}")
    print(f"  Has Pets: {client.special_needs.get('pets')}")

    # Initialize enhanced engine
    engine = EnhancedCommunityFilterEngine(
        'DataFile_students.xlsx',
        include_total_fees=True  # NEW: Include all first-month costs
    )

    # Apply filters
    results = engine.filter_communities(
        client,
        deduplicate=True,  # NEW: Limit results per community
        max_per_community=2  # Show top 2 options per community
    )

    # Show summary
    print(engine.get_recommendations_summary(results, top_n=10))

    # Save results
    if not results.empty:
        results.to_excel('filtered_communities_enhanced.xlsx', index=False)
        print(f"\nFull results saved to: filtered_communities_enhanced.xlsx")

    return results


if __name__ == '__main__':
    test_enhanced_engine()
