"""
Multi-Level Rank Aggregation System for Senior Living Recommendations
Uses weighted Borda count with parallel Gemini 2.5 Flash AI rankings
"""

import os
import json
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass, asdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import lru_cache
import pandas as pd
import numpy as np
from datetime import datetime

from google import genai
from google.genai import types
from geopy.distance import geodesic


@dataclass
class ClientRequirements:
    """Client requirements extracted from audio/text"""
    care_level: str
    enhanced: bool
    enriched: bool
    budget: float
    timeline: str
    location_preference: str
    special_needs: Dict[str, Any]
    client_name: Optional[str] = None
    notes: Optional[str] = None


@dataclass
class RankResult:
    """Result of a single ranking dimension"""
    dimension_name: str
    community_id: int
    rank: int
    score: float  # Raw score used for ranking
    reason: str
    method: str  # 'rule' or 'ai'


@dataclass
class CommunityRanking:
    """Complete ranking profile for a single community"""
    community_id: int
    community_name: str
    final_rank: int
    combined_rank_score: float

    # Individual dimension ranks
    business_rank: int
    total_cost_rank: int
    distance_rank: int
    availability_rank: int
    budget_efficiency_rank: int
    couple_rank: Optional[int]
    amenity_rank: int
    holistic_rank: int

    # Explanations
    business_reason: str
    total_cost_reason: str
    distance_reason: str
    availability_reason: str
    budget_efficiency_reason: str
    couple_reason: str
    amenity_reason: str
    holistic_reason: str

    # Key metrics for CRM
    monthly_fee: float
    distance_miles: float
    total_upfront_cost: float
    est_waitlist: str
    contract_rate: str
    work_with_placement: str

    # Full community data
    community_data: Dict[str, Any]


class RankingDimension:
    """Base class for all ranking dimensions"""

    def __init__(self, name: str, weight: float = 1.0):
        self.name = name
        self.weight = weight

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        """
        Rank communities for this dimension.
        Returns list of RankResult objects.
        Must be implemented by subclasses.
        """
        raise NotImplementedError


class BusinessValueRanker(RankingDimension):
    """Ranks by willingness to work x commission rate"""

    WILLINGNESS_MAP = {
        'Yes': 10,
        'Maybe': 7,
        'Prob not but might be open to one-off': 5,
        'Uncertain': 4,
        'No (for now)': 2,
        'Probably No': 1,
        'Very Likely No': 0,
        'No': 0
    }

    def __init__(self, weight: float = 3.0):
        super().__init__("Business Value", weight)

    def _parse_commission(self, contract_value: Any) -> float:
        """Parse commission rate from various formats"""
        if pd.isna(contract_value):
            return 0.0

        val_str = str(contract_value).strip()

        if val_str == '1':
            return 1.00
        elif val_str == '0.9':
            return 0.90
        elif val_str == '0.85':
            return 0.85
        elif val_str == '0.8':
            return 0.80
        elif '75%' in val_str and '100%' in val_str:
            return 0.875  # midpoint
        elif val_str.lower() in ['no', 'no ']:
            return 0.0
        else:
            # Try to parse as float
            try:
                return float(val_str)
            except:
                return 0.0

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        results = []

        for idx, row in communities.iterrows():
            willingness_raw = row.get('Work with Placement?', 'No')
            contract = row.get('Contract (w rate)?', 'No')

            # Handle boolean values from Excel (True/False)
            if willingness_raw == True or str(willingness_raw).strip().lower() == 'true':
                willingness = 'Yes'
            elif willingness_raw == False or str(willingness_raw).strip().lower() == 'false':
                willingness = 'No'
            else:
                willingness = willingness_raw

            willingness_score = self.WILLINGNESS_MAP.get(willingness, 0)
            commission_rate = self._parse_commission(contract)

            # Composite score
            business_score = willingness_score * commission_rate

            reason = f"Willingness: '{willingness}' ({willingness_score}/10) x Commission: {commission_rate*100:.0f}% = {business_score:.2f}"

            results.append(RankResult(
                dimension_name=self.name,
                community_id=row['CommunityID'],
                rank=0,  # Will be assigned after sorting
                score=business_score,
                reason=reason,
                method='rule'
            ))

        # Sort by score descending, assign ranks
        results.sort(key=lambda x: x.score, reverse=True)

        # Handle ties with average ranking
        self._assign_ranks_with_ties(results)

        return results

    def _assign_ranks_with_ties(self, results: List[RankResult]):
        """Assign ranks handling ties using average rank method"""
        i = 0
        while i < len(results):
            # Find all items with same score
            current_score = results[i].score
            j = i
            while j < len(results) and results[j].score == current_score:
                j += 1

            # Assign average rank to all tied items
            avg_rank = (i + 1 + j) / 2
            for k in range(i, j):
                results[k].rank = avg_rank

            i = j


class TotalCostRanker(RankingDimension):
    """Ranks by monthly fee + amortized upfront costs"""

    def __init__(self, weight: float = 2.0):
        super().__init__("Total Cost", weight)

    def _parse_numeric(self, value: Any, default: float = 0.0) -> float:
        """Parse numeric value from various formats"""
        if pd.isna(value):
            return default

        val_str = str(value).strip()
        # Remove dollar signs, commas
        val_str = val_str.replace('$', '').replace(',', '')

        try:
            return float(val_str)
        except:
            return default

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        results = []

        has_pet = client_req.special_needs.get('pets', False)

        for idx, row in communities.iterrows():
            monthly_fee = self._parse_numeric(row.get('Monthly Fee', 0))
            deposit = self._parse_numeric(row.get('Deposit', 0))
            move_in_fee = self._parse_numeric(row.get('Move-In Fee', 0))
            community_fee = self._parse_numeric(row.get('Community Fee - One Time', 0))
            pet_fee = self._parse_numeric(row.get('Pet Fee', 0)) if has_pet else 0

            upfront_cost = deposit + move_in_fee + community_fee + pet_fee
            monthly_equivalent = monthly_fee + (upfront_cost / 12)

            reason = f"${monthly_fee:,.0f}/mo + ${upfront_cost:,.0f} upfront (${upfront_cost/12:,.0f}/mo amortized) = ${monthly_equivalent:,.0f}/mo equivalent"

            results.append(RankResult(
                dimension_name=self.name,
                community_id=row['CommunityID'],
                rank=0,
                score=monthly_equivalent,
                reason=reason,
                method='rule'
            ))

        # Sort by cost ascending (lower is better)
        results.sort(key=lambda x: x.score)
        self._assign_ranks_with_ties(results)

        return results

    def _assign_ranks_with_ties(self, results: List[RankResult]):
        """Assign ranks handling ties"""
        i = 0
        while i < len(results):
            current_score = results[i].score
            j = i
            while j < len(results) and abs(results[j].score - current_score) < 0.01:  # Within $0.01
                j += 1

            avg_rank = (i + 1 + j) / 2
            for k in range(i, j):
                results[k].rank = avg_rank

            i = j


class DistanceRanker(RankingDimension):
    """Ranks by geographic distance from client"""

    def __init__(self, geocoder, weight: float = 2.0):
        super().__init__("Geographic Distance", weight)
        self.geocoder = geocoder
        # Import location resolver for converting city names to ZIP codes
        from location_resolver import get_location_resolver
        self.location_resolver = get_location_resolver()

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        results = []
        # Resolve location to ZIP code (handles "Rochester area", city names, etc.)
        client_zip = self.location_resolver.resolve_location(client_req.location_preference)

        for idx, row in communities.iterrows():
            # Handle ZIP codes that may be floats from Excel (e.g., 14526.0)
            if pd.notna(row['ZIP']):
                zip_str = str(row['ZIP']).strip()
                if '.' in zip_str:
                    zip_str = zip_str.split('.')[0]
                community_zip = zip_str
            else:
                community_zip = None

            if community_zip:
                distance = self.geocoder.calculate_distance(client_zip, community_zip)
            else:
                distance = 9999  # Unknown distance ranks last

            reason = f"{distance:.2f} miles from client location (ZIP {client_zip})"

            results.append(RankResult(
                dimension_name=self.name,
                community_id=row['CommunityID'],
                rank=0,
                score=distance,
                reason=reason,
                method='rule'
            ))

        # Sort by distance ascending
        results.sort(key=lambda x: x.score)
        self._assign_ranks_with_ties(results)

        return results

    def _assign_ranks_with_ties(self, results: List[RankResult]):
        i = 0
        while i < len(results):
            current_score = results[i].score
            j = i
            while j < len(results) and abs(results[j].score - current_score) < 0.1:  # Within 0.1 miles
                j += 1

            avg_rank = (i + 1 + j) / 2
            for k in range(i, j):
                results[k].rank = avg_rank

            i = j


class BudgetEfficiencyRanker(RankingDimension):
    """Ranks by cost as % of client budget (value for money)"""

    def __init__(self, weight: float = 1.5):
        super().__init__("Budget Efficiency", weight)

    def _parse_numeric(self, value: Any, default: float = 0.0) -> float:
        if pd.isna(value):
            return default
        val_str = str(value).strip().replace('$', '').replace(',', '')
        try:
            return float(val_str)
        except:
            return default

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        results = []

        for idx, row in communities.iterrows():
            monthly_fee = self._parse_numeric(row.get('Monthly Fee', 0))
            # Ensure budget is a numeric value
            numeric_budget = self._parse_numeric(getattr(client_req, 'budget', 0), 0.0)
            budget_ratio = (monthly_fee / numeric_budget) * 100 if numeric_budget > 0 else 100

            budget_str = f"${numeric_budget:,.0f}" if numeric_budget > 0 else "N/A"
            reason = f"${monthly_fee:,.0f}/mo is {budget_ratio:.1f}% of {budget_str} budget"

            results.append(RankResult(
                dimension_name=self.name,
                community_id=row['CommunityID'],
                rank=0,
                score=budget_ratio,
                reason=reason,
                method='rule'
            ))

        # Sort by ratio ascending (lower % is better value)
        results.sort(key=lambda x: x.score)
        self._assign_ranks_with_ties(results)

        return results

    def _assign_ranks_with_ties(self, results: List[RankResult]):
        i = 0
        while i < len(results):
            current_score = results[i].score
            j = i
            while j < len(results) and abs(results[j].score - current_score) < 1.0:  # Within 1%
                j += 1

            avg_rank = (i + 1 + j) / 2
            for k in range(i, j):
                results[k].rank = avg_rank

            i = j


class CoupleFriendlinessRanker(RankingDimension):
    """Ranks by 2nd person fee (if applicable)"""

    def __init__(self, weight: float = 1.0):
        super().__init__("Couple Friendliness", weight)

    def _parse_numeric(self, value: Any, default: float = None) -> Optional[float]:
        if pd.isna(value):
            return default
        val_str = str(value).strip().replace('$', '').replace(',', '')
        try:
            return float(val_str)
        except:
            return default

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        results = []

        # Check if client needs 2nd person accommodation
        needs_second_person = client_req.special_needs.get('second_person', False)

        if not needs_second_person:
            # If not applicable, all communities get neutral middle rank
            neutral_rank = (len(communities) + 1) / 2
            for idx, row in communities.iterrows():
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=row['CommunityID'],
                    rank=neutral_rank,
                    score=0,
                    reason="Not applicable (client is single)",
                    method='rule'
                ))
            return results

        # Rank by 2nd person fee
        for idx, row in communities.iterrows():
            second_person_fee = self._parse_numeric(row.get('2nd Person Fee'))

            if second_person_fee is not None:
                reason = f"${second_person_fee:,.0f}/mo for second person"
                score = second_person_fee
            else:
                reason = "No 2nd person fee data (risky for couples)"
                score = 99999  # Rank last

            results.append(RankResult(
                dimension_name=self.name,
                community_id=row['CommunityID'],
                rank=0,
                score=score,
                reason=reason,
                method='rule'
            ))

        # Sort by fee ascending
        results.sort(key=lambda x: x.score)
        self._assign_ranks_with_ties(results)

        return results

    def _assign_ranks_with_ties(self, results: List[RankResult]):
        i = 0
        while i < len(results):
            current_score = results[i].score
            j = i
            while j < len(results) and abs(results[j].score - current_score) < 10.0:  # Within $10
                j += 1

            avg_rank = (i + 1 + j) / 2
            for k in range(i, j):
                results[k].rank = avg_rank

            i = j


class GeminiRanker(RankingDimension):
    """Base class for AI-powered ranking using Gemini 2.5 Flash"""

    def __init__(self, name: str, weight: float = 1.0):
        super().__init__(name, weight)

        # Initialize Gemini 2.5 Flash
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            raise ValueError("GEMINI_API_KEY environment variable not set")

        self.client = genai.Client(api_key=api_key)
        self.model_name = 'gemini-2.5-flash'

    def _call_gemini(self, prompt: str, timeout: int = 60, max_retries: int = 3) -> Dict[str, Any]:
        """Call Gemini API with structured JSON output, timeout, and retry logic
        
        Note: The timeout parameter is accepted for API compatibility but the new 
        google.genai SDK doesn't support timeout configuration in the same way.
        Timeout behavior is now handled by the SDK's default settings and network layer.
        """
        import time

        for attempt in range(max_retries):
            try:
                # Note: google.genai (v1.51.0) doesn't support request_options timeout
                # The SDK handles timeouts internally at the network layer
                response = self.client.models.generate_content(
                    model=self.model_name,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.0,
                        response_mime_type="application/json"
                    )
                )
                return json.loads(response.text)
            except Exception as e:
                error_msg = str(e)

                # Check if it's a timeout or rate limit error
                if '504' in error_msg or 'timeout' in error_msg.lower():
                    if attempt < max_retries - 1:
                        wait_time = (2 ** attempt) * 2  # Exponential backoff: 2s, 4s, 8s
                        print(f"  [RETRY] {self.name} timed out, retrying in {wait_time}s (attempt {attempt + 1}/{max_retries})...")
                        time.sleep(wait_time)
                        continue
                    else:
                        print(f"  [WARNING] Gemini API error in {self.name} after {max_retries} attempts: {e}")
                        return {"rankings": []}
                elif '429' in error_msg or 'quota' in error_msg.lower():
                    print(f"  [WARNING] Gemini API quota exceeded in {self.name}: {e}")
                    return {"rankings": []}
                else:
                    print(f"  [WARNING] Gemini API error in {self.name}: {e}")
                    return {"rankings": []}

        return {"rankings": []}

    def _prepare_community_data(self, communities: pd.DataFrame, fields: List[str]) -> List[Dict]:
        """Prepare community data for Gemini prompt"""
        community_list = []
        for idx, row in communities.iterrows():
            comm_data = {'id': int(row['CommunityID'])}
            for field in fields:
                value = row.get(field)
                if pd.notna(value):
                    comm_data[field] = str(value) if not isinstance(value, (int, float, bool)) else value
                else:
                    comm_data[field] = None
            community_list.append(comm_data)
        return community_list


class AvailabilityRanker(GeminiRanker):
    """AI-powered ranking of availability/timeline match"""

    def __init__(self, weight: float = 1.5):
        super().__init__("Availability Match", weight)

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        community_data = self._prepare_community_data(
            communities,
            ['CommunityID', 'Est. Waitlist Length', 'Type of Service']
        )

        prompt = f"""You are an expert at matching senior living community availability with client timeline needs.

CLIENT TIMELINE: {client_req.timeline}
CLIENT NOTES: {client_req.notes or 'None provided'}
CLIENT CARE LEVEL: {client_req.care_level}

COMMUNITIES TO RANK:
{json.dumps(community_data, indent=2)}

RANKING CRITERIA:
- "Available" + immediate need = Best match (rank 1)
- "1-2 months" + near-term need = Good match
- "7-12 months" + flexible timeline = Acceptable
- Availability sooner than needed = Neutral (middle ranks)
- Availability later than needed = Poor match (lower ranks)
- "Unconfirmed" = Risky but possible (middle-lower ranks)
- "Waitlist but Unspecified" = Very risky (near bottom)

YOUR TASK:
Rank all {len(community_data)} communities from 1 (best availability match) to {len(community_data)} (worst match).
Consider nuances in the client's timeline description and notes.

IMPORTANT:
- Every community must get a unique rank from 1 to {len(community_data)}
- If multiple communities are similar, rank them by subtleties in waitlist description
- Provide specific reasoning for each ranking

Return ONLY valid JSON (no markdown, no code blocks):
{{
  "rankings": [
    {{
      "community_id": 1,
      "rank": 1,
      "reason": "Available immediately, perfect for urgent placement need"
    }},
    ...
  ]
}}"""

        response = self._call_gemini(prompt)

        # Convert to RankResult objects
        results = []
        rankings_data = response.get('rankings', [])

        # Create a map for quick lookup
        rank_map = {r['community_id']: r for r in rankings_data}

        for idx, row in communities.iterrows():
            comm_id = int(row['CommunityID'])
            if comm_id in rank_map:
                rank_info = rank_map[comm_id]
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=comm_id,
                    rank=rank_info['rank'],
                    score=rank_info['rank'],  # Use rank as score
                    reason=rank_info['reason'],
                    method='ai'
                ))
            else:
                # Fallback if Gemini didn't rank this community
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=comm_id,
                    rank=len(communities),
                    score=len(communities),
                    reason="Not ranked by AI (using default)",
                    method='ai'
                ))

        return results


class AmenityRanker(GeminiRanker):
    """AI-powered ranking of amenity and lifestyle match"""

    def __init__(self, weight: float = 1.0):
        super().__init__("Amenity & Lifestyle Match", weight)

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[RankResult]:
        # Prepare community data with truncated Msc Fees (to avoid huge prompts)
        community_list = []
        for idx, row in communities.iterrows():
            msc_fees = row.get('Msc Fees')
            # Truncate Msc Fees to first 150 characters to reduce token count
            if pd.notna(msc_fees):
                msc_fees_truncated = str(msc_fees)[:150] + '...' if len(str(msc_fees)) > 150 else str(msc_fees)
            else:
                msc_fees_truncated = None

            community_list.append({
                'id': int(row['CommunityID']),
                'apartment_type': row.get('Apartment Type'),
                'msc_fees': msc_fees_truncated,
                'enhanced': row.get('Enhanced'),
                'enriched': row.get('Enriched')
            })

        community_data = community_list

        prompt = f"""You are an expert at matching senior living community amenities with client preferences.

CLIENT PREFERENCES:
- Apartment type preference: {client_req.special_needs.get('apartment_type_preference', 'None specified')}
- Special needs: {json.dumps(client_req.special_needs, indent=2)}
- Notes: {client_req.notes or 'None provided'}
- Enhanced services needed: {client_req.enhanced}
- Enriched housing needed: {client_req.enriched}

COMMUNITIES TO RANK:
{json.dumps(community_data, indent=2)}

RANKING CRITERIA:
- Apartment type matches client preference exactly = Best
- Enhanced/Enriched services match client needs = Better
- Additional amenities mentioned in Msc Fees that align with needs = Bonus
- Studio when client wants 1BR = Worse
- Missing amenity data = Risky (lower ranks)

YOUR TASK:
Rank all {len(community_data)} communities from 1 (best amenity match) to {len(community_data)} (worst match).
Consider both explicit preferences and implicit needs from notes.

IMPORTANT:
- Every community must get a unique rank
- Provide specific reasoning mentioning which amenities matched or didn't match

Return ONLY valid JSON:
{{
  "rankings": [
    {{
      "community_id": 1,
      "rank": 1,
      "reason": "Has preferred 1BR deluxe + enhanced services Level 2 matching client's medical needs"
    }},
    ...
  ]
}}"""

        response = self._call_gemini(prompt)

        results = []
        rankings_data = response.get('rankings', [])
        rank_map = {r['community_id']: r for r in rankings_data}

        for idx, row in communities.iterrows():
            comm_id = int(row['CommunityID'])
            if comm_id in rank_map:
                rank_info = rank_map[comm_id]
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=comm_id,
                    rank=rank_info['rank'],
                    score=rank_info['rank'],
                    reason=rank_info['reason'],
                    method='ai'
                ))
            else:
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=comm_id,
                    rank=len(communities),
                    score=len(communities),
                    reason="Not ranked by AI",
                    method='ai'
                ))

        return results


class HolisticRanker(GeminiRanker):
    """AI-powered holistic ranking considering all factors together"""

    def __init__(self, weight: float = 2.0):
        super().__init__("Holistic Fit", weight)

    def rank(self, communities: pd.DataFrame, client_req: ClientRequirements,
             previous_rankings: Dict[str, List[RankResult]]) -> List[RankResult]:
        """
        Holistic ranking with context from previous rankings
        """

        # Prepare enriched community data with previous ranks
        enriched_data = []
        for idx, row in communities.iterrows():
            comm_id = int(row['CommunityID'])
            comm_info = {
                'id': comm_id,
                'monthly_fee': row.get('Monthly Fee'),
                'distance_miles': None,  # Will be filled from distance ranker
                'waitlist': row.get('Est. Waitlist Length'),
                'work_with_placement': row.get('Work with Placement?'),
                'contract_rate': row.get('Contract (w rate)?'),
                'apartment_type': row.get('Apartment Type'),
                'enhanced': row.get('Enhanced'),
                'enriched': row.get('Enriched'),
                'previous_ranks': {}
            }

            # Add previous ranking results
            for dimension, rank_results in previous_rankings.items():
                for rr in rank_results:
                    if rr.community_id == comm_id:
                        comm_info['previous_ranks'][dimension] = {
                            'rank': rr.rank,
                            'reason': rr.reason
                        }
                        if dimension == 'Geographic Distance':
                            comm_info['distance_miles'] = rr.score
                        break

            enriched_data.append(comm_info)

        # Simplified data for faster processing
        simplified_data = []
        for comm in enriched_data:
            simplified_data.append({
                'id': comm['id'],
                'monthly_fee': comm['monthly_fee'],
                'distance': comm['distance_miles'],
                'waitlist': comm['waitlist'],
                'business_rank': comm['previous_ranks'].get('Business Value', {}).get('rank', 'N/A'),
                'cost_rank': comm['previous_ranks'].get('Total Cost', {}).get('rank', 'N/A'),
                'distance_rank': comm['previous_ranks'].get('Geographic Distance', {}).get('rank', 'N/A'),
                'availability_rank': comm['previous_ranks'].get('Availability Match', {}).get('rank', 'N/A'),
                'amenity_rank': comm['previous_ranks'].get('Amenity & Lifestyle Match', {}).get('rank', 'N/A')
            })

        budget_str = f"${client_req.budget:,.0f}" if client_req.budget else "N/A"
        prompt = f"""Holistic ranking of {len(simplified_data)} senior living communities.

CLIENT: {client_req.care_level}, {budget_str}/mo budget, {client_req.timeline} timeline

COMMUNITIES (id, monthly_fee, distance_miles, waitlist, previous_ranks):
{json.dumps(simplified_data, indent=1)}

TASK: Rank 1 (best overall) to {len(simplified_data)} (worst). Consider synergies (e.g., close+available+affordable=great).

Return JSON:
{{
  "rankings": [
    {{"community_id": 1, "rank": 1, "reason": "Best balance of cost, distance, and availability"}},
    ...
  ]
}}"""

        response = self._call_gemini(prompt)

        results = []
        rankings_data = response.get('rankings', [])
        rank_map = {r['community_id']: r for r in rankings_data}

        for idx, row in communities.iterrows():
            comm_id = int(row['CommunityID'])
            if comm_id in rank_map:
                rank_info = rank_map[comm_id]
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=comm_id,
                    rank=rank_info['rank'],
                    score=rank_info['rank'],
                    reason=rank_info['reason'],
                    method='ai'
                ))
            else:
                results.append(RankResult(
                    dimension_name=self.name,
                    community_id=comm_id,
                    rank=len(communities),
                    score=len(communities),
                    reason="Not ranked by AI",
                    method='ai'
                ))

        return results


class MultiLevelRankingEngine:
    """
    Main ranking engine using weighted Borda count aggregation
    with parallel execution of ranking dimensions
    """

    def __init__(self, geocoder, weights: Optional[Dict[str, float]] = None):
        """
        Initialize ranking engine

        Args:
            geocoder: Geocoding utility for distance calculations
            weights: Optional custom weights for each dimension
        """
        self.geocoder = geocoder

        # Default equal weights (can be adjusted by client)
        self.weights = weights or {
            'business': 1.0,
            'cost': 1.0,
            'distance': 1.0,
            'availability': 1.0,
            'budget_efficiency': 1.0,
            'couple': 1.0,
            'amenity': 1.0,
            'holistic': 1.0
        }

        # Initialize ranking dimensions
        self.rankers = {
            'business': BusinessValueRanker(weight=self.weights['business']),
            'cost': TotalCostRanker(weight=self.weights['cost']),
            'distance': DistanceRanker(geocoder, weight=self.weights['distance']),
            'budget_efficiency': BudgetEfficiencyRanker(weight=self.weights['budget_efficiency']),
            'couple': CoupleFriendlinessRanker(weight=self.weights['couple']),
            'availability': AvailabilityRanker(weight=self.weights['availability']),
            'amenity': AmenityRanker(weight=self.weights['amenity']),
            'holistic': None  # Will be initialized later with context
        }

    def rank_communities(self, communities: pd.DataFrame, client_req: ClientRequirements) -> List[CommunityRanking]:
        """
        Rank communities using multi-level rank aggregation

        OPTIMIZATION: Pre-filter to top 10 candidates using rule-based rankings,
        then apply expensive AI rankings only to those top 10.
        This ensures we always return exactly 5 recommendations with minimal processing time.

        Returns:
            List of CommunityRanking objects sorted by final rank
        """
        print(f"[RANKING] Processing {len(communities)} communities across 8 dimensions...")

        # Step 1: Execute rule-based rankings in parallel on ALL communities
        rule_based_rankers = ['business', 'cost', 'distance', 'budget_efficiency', 'couple']
        all_rankings = {}

        print("[PHASE 1] Running rule-based rankings in parallel on all communities...")
        with ThreadPoolExecutor(max_workers=5) as executor:
            future_to_dimension = {
                executor.submit(self.rankers[dim].rank, communities, client_req): dim
                for dim in rule_based_rankers
            }

            for future in as_completed(future_to_dimension):
                dimension = future_to_dimension[future]
                try:
                    results = future.result()
                    all_rankings[dimension] = results
                    print(f"  [OK] {dimension} ranking complete")
                except Exception as e:
                    print(f"  [ERROR] {dimension} ranking failed: {e}")
                    # Fallback: assign sequential ranks
                    all_rankings[dimension] = self._fallback_ranking(communities, dimension)

        # OPTIMIZATION: Pre-filter to top 10 candidates before AI ranking
        # This dramatically reduces API calls (10 × 3 = 30 instead of 35 × 3 = 105)
        print("[OPTIMIZATION] Selecting top 10 candidates based on rule-based rankings...")
        top_candidates = self._select_top_candidates(communities, all_rankings, top_n=10)
        print(f"  [SELECTED] Top 10 candidates from {len(communities)} communities for AI ranking")

        # Step 2: Execute AI rankings in parallel ONLY on top candidates
        ai_rankers = ['availability', 'amenity']

        print("[PHASE 2] Running AI-powered rankings on top 10 candidates (Gemini 2.5 Flash)...")
        with ThreadPoolExecutor(max_workers=2) as executor:
            future_to_dimension = {
                executor.submit(self.rankers[dim].rank, top_candidates, client_req): dim
                for dim in ai_rankers
            }

            for future in as_completed(future_to_dimension):
                dimension = future_to_dimension[future]
                try:
                    results = future.result()
                    all_rankings[dimension] = results
                    print(f"  [OK] {dimension} ranking complete (AI)")
                except Exception as e:
                    print(f"  [ERROR] {dimension} ranking failed: {e}")
                    all_rankings[dimension] = self._fallback_ranking(communities, dimension)

        # Step 3: Holistic ranking ONLY on top candidates (needs context from previous rankings)
        print("[PHASE 3] Running holistic AI ranking on top 10 candidates...")
        holistic_ranker = HolisticRanker(weight=self.weights['holistic'])
        try:
            all_rankings['holistic'] = holistic_ranker.rank(top_candidates, client_req, all_rankings)
            print("  [OK] holistic ranking complete (AI)")
        except Exception as e:
            print(f"  [ERROR] holistic ranking failed: {e}")
            all_rankings['holistic'] = self._fallback_ranking(top_candidates, 'holistic')

        # Step 4: Aggregate ranks using weighted Borda count ONLY for top candidates
        print("[PHASE 4] Aggregating ranks using weighted Borda count...")
        final_rankings = self._aggregate_ranks(top_candidates, all_rankings, client_req)

        # Sort by final rank
        final_rankings.sort(key=lambda x: x.combined_rank_score)

        # Assign final ranks
        for i, ranking in enumerate(final_rankings, start=1):
            ranking.final_rank = i

        # ALWAYS return exactly 5 recommendations (or fewer if less than 5 communities)
        top_5 = final_rankings[:5]

        print(f"[COMPLETE] Ranking complete! Top recommendation: {top_5[0].community_name}")
        print(f"[RETURNED] {len(top_5)} recommendations (always max 5)")

        return top_5

    def _select_top_candidates(self, communities: pd.DataFrame,
                                rule_rankings: Dict[str, List[RankResult]],
                                top_n: int = 10) -> pd.DataFrame:
        """
        Select top N candidates based on rule-based rankings only.
        Uses simple average rank across all rule-based dimensions.

        Args:
            communities: Full DataFrame of communities
            rule_rankings: Dictionary of rule-based ranking results
            top_n: Number of top candidates to select (default 10)

        Returns:
            DataFrame of top N candidates
        """
        # Calculate average rank for each community across rule-based dimensions
        community_avg_ranks = {}

        for idx, row in communities.iterrows():
            comm_id = int(row['CommunityID'])
            ranks = []

            # Collect ranks from all rule-based dimensions
            for dimension, rank_list in rule_rankings.items():
                for rank_result in rank_list:
                    if rank_result.community_id == comm_id:
                        ranks.append(rank_result.rank)
                        break

            # Average rank (lower is better)
            if ranks:
                community_avg_ranks[comm_id] = sum(ranks) / len(ranks)
            else:
                community_avg_ranks[comm_id] = 9999  # Fallback for missing ranks

        # Sort community IDs by average rank
        sorted_comm_ids = sorted(community_avg_ranks.keys(), key=lambda x: community_avg_ranks[x])

        # Select top N
        top_comm_ids = sorted_comm_ids[:top_n]

        # Filter DataFrame to only include top N
        top_candidates = communities[communities['CommunityID'].isin(top_comm_ids)].copy()

        return top_candidates

    def _fallback_ranking(self, communities: pd.DataFrame, dimension: str) -> List[RankResult]:
        """Fallback ranking if a dimension fails"""
        return [
            RankResult(
                dimension_name=dimension,
                community_id=row['CommunityID'],
                rank=i+1,
                score=i+1,
                reason="Fallback ranking (error in dimension)",
                method='fallback'
            )
            for i, (idx, row) in enumerate(communities.iterrows())
        ]

    def _aggregate_ranks(self, communities: pd.DataFrame, all_rankings: Dict[str, List[RankResult]],
                        client_req: ClientRequirements) -> List[CommunityRanking]:
        """
        Aggregate rankings using weighted Borda count

        Borda count: Lower combined score = Better
        """
        community_scores = {}

        # Initialize score tracking for each community
        for idx, row in communities.iterrows():
            comm_id = int(row['CommunityID'])
            community_scores[comm_id] = {
                'community_id': comm_id,
                'community_name': f"Community {comm_id}",  # Will be updated with actual name
                'ranks': {},
                'reasons': {},
                'combined_score': 0.0,
                'community_data': row.to_dict()
            }

        # Collect ranks and compute weighted sum
        dimension_mapping = {
            'business': 'business_rank',
            'cost': 'total_cost_rank',
            'distance': 'distance_rank',
            'availability': 'availability_rank',
            'budget_efficiency': 'budget_efficiency_rank',
            'couple': 'couple_rank',
            'amenity': 'amenity_rank',
            'holistic': 'holistic_rank'
        }

        for dimension, rank_list in all_rankings.items():
            weight = self.weights.get(dimension, 1.0)

            for rank_result in rank_list:
                comm_id = rank_result.community_id
                if comm_id in community_scores:
                    # Weighted rank contribution
                    weighted_rank = rank_result.rank * weight
                    community_scores[comm_id]['combined_score'] += weighted_rank

                    # Store individual rank
                    field_name = dimension_mapping.get(dimension, f'{dimension}_rank')
                    community_scores[comm_id]['ranks'][field_name] = rank_result.rank
                    community_scores[comm_id]['reasons'][f'{field_name}_reason'] = rank_result.reason

        # Convert to CommunityRanking objects
        final_rankings = []

        for comm_id, score_data in community_scores.items():
            # Extract key metrics for CRM
            comm_data = score_data['community_data']
            monthly_fee = self._safe_float(comm_data.get('Monthly Fee', 0))

            # Get distance from distance ranker
            distance_miles = 0.0
            for rr in all_rankings.get('distance', []):
                if rr.community_id == comm_id:
                    distance_miles = rr.score
                    break

            # Calculate total upfront cost
            upfront_cost = (
                self._safe_float(comm_data.get('Deposit', 0)) +
                self._safe_float(comm_data.get('Move-In Fee', 0)) +
                self._safe_float(comm_data.get('Community Fee - One Time', 0)) +
                (self._safe_float(comm_data.get('Pet Fee', 0)) if client_req.special_needs.get('pets') else 0)
            )

            ranking_obj = CommunityRanking(
                community_id=comm_id,
                community_name=f"Community {comm_id}",
                final_rank=0,  # Will be assigned after sorting
                combined_rank_score=score_data['combined_score'],

                # Individual ranks
                business_rank=int(score_data['ranks'].get('business_rank', 0)),
                total_cost_rank=int(score_data['ranks'].get('total_cost_rank', 0)),
                distance_rank=int(score_data['ranks'].get('distance_rank', 0)),
                availability_rank=int(score_data['ranks'].get('availability_rank', 0)),
                budget_efficiency_rank=int(score_data['ranks'].get('budget_efficiency_rank', 0)),
                couple_rank=int(score_data['ranks'].get('couple_rank', 0)) if score_data['ranks'].get('couple_rank') else None,
                amenity_rank=int(score_data['ranks'].get('amenity_rank', 0)),
                holistic_rank=int(score_data['ranks'].get('holistic_rank', 0)),

                # Reasons (with improved fallback for holistic)
                business_reason=score_data['reasons'].get('business_rank_reason', ''),
                total_cost_reason=score_data['reasons'].get('total_cost_rank_reason', ''),
                distance_reason=score_data['reasons'].get('distance_rank_reason', ''),
                availability_reason=score_data['reasons'].get('availability_rank_reason', ''),
                budget_efficiency_reason=score_data['reasons'].get('budget_efficiency_rank_reason', ''),
                couple_reason=score_data['reasons'].get('couple_rank_reason', ''),
                amenity_reason=score_data['reasons'].get('amenity_rank_reason', ''),
                holistic_reason=score_data['reasons'].get('holistic_rank_reason', '') or self._generate_fallback_holistic_reason(comm_data, monthly_fee, client_req),

                # Key metrics
                monthly_fee=monthly_fee,
                distance_miles=distance_miles,
                total_upfront_cost=upfront_cost,
                est_waitlist=str(comm_data.get('Est. Waitlist Length', '')),
                contract_rate=str(comm_data.get('Contract (w rate)?', '')),
                work_with_placement=str(comm_data.get('Work with Placement?', '')),

                # Full data
                community_data=comm_data
            )

            final_rankings.append(ranking_obj)

        return final_rankings

    def _safe_float(self, value: Any, default: float = 0.0) -> float:
        """Safely convert value to float"""
        if pd.isna(value):
            return default
        try:
            if isinstance(value, str):
                return float(value.replace('$', '').replace(',', ''))
            return float(value)
        except:
            return default

    def _generate_fallback_holistic_reason(self, comm_data: Dict, monthly_fee: float, client_req: ClientRequirements) -> str:
        """Generate a basic holistic reason when AI ranking fails"""
        waitlist = str(comm_data.get('Est. Waitlist Length', 'Unconfirmed'))

        # Assess availability match
        if client_req.timeline == 'immediate':
            if 'Available' in waitlist:
                timeline_match = "available for immediate need"
            elif 'Unconfirmed' in waitlist:
                timeline_match = "availability unconfirmed, less ideal for immediate need"
            else:
                timeline_match = f"has waitlist ({waitlist}), may not meet immediate timeline"
        elif client_req.timeline == 'near-term':
            if 'Available' in waitlist or '1-2 months' in waitlist:
                timeline_match = "available for near-term timeline"
            elif 'Unconfirmed' in waitlist:
                timeline_match = "availability unconfirmed, less ideal for near-term timeline"
            else:
                timeline_match = f"waitlist status ({waitlist}) uncertain for near-term need"
        else:
            timeline_match = f"waitlist: {waitlist}"

        # Assess value
        budget_ratio = (monthly_fee / client_req.budget) * 100 if client_req.budget > 0 else 100
        if budget_ratio <= 60:
            value_assessment = "excellent value"
        elif budget_ratio <= 75:
            value_assessment = "good value"
        elif budget_ratio <= 90:
            value_assessment = "fair value"
        else:
            value_assessment = "near budget limit"

        # Generate reason
        reason = f"{timeline_match.capitalize()}. Monthly fee of ${monthly_fee:,.0f} is {value_assessment}"

        # Add availability warning if unconfirmed
        if 'unconfirmed' in waitlist.lower() or 'Unconfirmed' in waitlist:
            reason += " if available"

        reason += "."

        return reason

    def export_to_crm_format(self, rankings: List[CommunityRanking], client_req: ClientRequirements) -> Dict[str, Any]:
        """
        Export rankings to structured format for CRM integration
        """
        return {
            "client_info": {
                "client_name": client_req.client_name or "Unknown",
                "care_level": client_req.care_level,
                "budget": client_req.budget,
                "timeline": client_req.timeline,
                "location_preference": client_req.location_preference,
                "special_needs": client_req.special_needs,
                "processed_date": datetime.now().isoformat()
            },
            "ranking_weights": self.weights,
            "recommendations": [
                {
                    "final_rank": r.final_rank,
                    "community_id": r.community_id,
                    "community_name": r.community_name,
                    "combined_rank_score": round(r.combined_rank_score, 2),

                    "key_metrics": {
                        "monthly_fee": r.monthly_fee,
                        "distance_miles": round(r.distance_miles, 2),
                        "total_upfront_cost": r.total_upfront_cost,
                        "est_waitlist": r.est_waitlist,
                        "contract_rate": r.contract_rate,
                        "work_with_placement": r.work_with_placement
                    },

                    "rankings": {
                        "business_rank": r.business_rank,
                        "total_cost_rank": r.total_cost_rank,
                        "distance_rank": r.distance_rank,
                        "availability_rank": r.availability_rank,
                        "budget_efficiency_rank": r.budget_efficiency_rank,
                        "couple_rank": r.couple_rank,
                        "amenity_rank": r.amenity_rank,
                        "holistic_rank": r.holistic_rank
                    },

                    "explanations": {
                        "business_reason": r.business_reason,
                        "total_cost_reason": r.total_cost_reason,
                        "distance_reason": r.distance_reason,
                        "availability_reason": r.availability_reason,
                        "budget_efficiency_reason": r.budget_efficiency_reason,
                        "couple_reason": r.couple_reason,
                        "amenity_reason": r.amenity_reason,
                        "holistic_reason": r.holistic_reason
                    }
                }
                for r in rankings
            ],

            "summary": {
                "total_matches": len(rankings),
                "avg_monthly_fee": round(np.mean([r.monthly_fee for r in rankings]), 2),
                "avg_distance_miles": round(np.mean([r.distance_miles for r in rankings]), 2),
                "top_recommendation": rankings[0].community_name if rankings else None,
                "top_recommendation_reason": rankings[0].holistic_reason if rankings else None
            }
        }
