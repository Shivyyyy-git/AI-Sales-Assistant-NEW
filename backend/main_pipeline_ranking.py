"""
Multi-Level Ranking Pipeline: Senior Living Community Recommendation System
Integrates Gemini 2.5 Flash + Multi-Level Rank Aggregation Engine
"""
import os
import json
import time
from pathlib import Path
from typing import Optional, Dict, Any
from gemini_audio_processor import GeminiAudioProcessor
from community_filter_engine_enhanced import EnhancedCommunityFilterEngine
from ranking_engine import MultiLevelRankingEngine, ClientRequirements
from geocoding_utils import ZipCodeGeocoder


class RankingBasedRecommendationSystem:
    """
    Advanced recommendation system using multi-level rank aggregation:
    1. Processes audio/text input with Gemini 2.5 Flash
    2. Applies hard filters (care level, budget, timeline)
    3. Ranks filtered communities across 8 dimensions (5 rule-based + 3 AI)
    4. Aggregates ranks using weighted Borda count
    5. Returns explainable, ranked recommendations ready for CRM
    """

    def __init__(self,
                 data_file_path: str = 'DataFile_students_OPTIMIZED.xlsx',
                 ranking_weights: Optional[Dict[str, float]] = None):
        """
        Initialize the ranking-based system

        Args:
            data_file_path: Path to community data Excel file
            ranking_weights: Optional custom weights for ranking dimensions
                           Default: all weights = 1.0 (equal weighting)
        """
        print("\n" + "="*80)
        print("INITIALIZING MULTI-LEVEL RANKING SYSTEM")
        print("="*80)

        # Initialize components
        self.audio_processor = GeminiAudioProcessor()
        self.filter_engine = EnhancedCommunityFilterEngine(
            data_file_path,
            include_total_fees=True
        )
        self.geocoder = ZipCodeGeocoder()

        # Initialize ranking engine with custom or default weights
        self.ranking_weights = ranking_weights or {
            'business': 1.0,          # Business value (willingness x commission)
            'cost': 1.0,              # Total cost (monthly + amortized upfront)
            'distance': 1.0,          # Geographic distance
            'availability': 1.0,      # Timeline match (AI)
            'budget_efficiency': 1.0, # Value for money
            'couple': 1.0,            # 2nd person accommodation
            'amenity': 1.0,           # Lifestyle match (AI)
            'holistic': 1.0           # Overall fit (AI)
        }

        self.ranking_engine = MultiLevelRankingEngine(
            geocoder=self.geocoder,
            weights=self.ranking_weights
        )

        print(f"[CONFIG] Data File: {data_file_path}")
        print(f"[CONFIG] Ranking Weights: {self.ranking_weights}")
        print("[SUCCESS] System initialized with Gemini 2.5 Flash")
        print("="*80)

    def process_audio_file(self, audio_path: str, language: str = 'english', output_file: Optional[str] = None) -> dict:
        """
        Process an audio file and generate ranked recommendations

        Args:
            audio_path: Path to audio file
            language: Language constraint ('english', 'hindi', 'spanish')
            output_file: Optional path to save results

        Returns:
            Dict containing client requirements and ranked recommendations
        """
        # Start E2E timer
        e2e_start_time = time.time()

        print("\n" + "="*80)
        print("PROCESSING AUDIO FILE")
        print("="*80)

        # Initialize metrics tracking
        metrics = {
            'timings': {},
            'token_counts': {
                'total_input_tokens': 0,
                'total_output_tokens': 0,
                'total_tokens': 0
            },
            'api_calls': 0
        }

        # Step 1: Extract client requirements from audio using Gemini
        print("\n[PHASE 1] EXTRACTING CLIENT REQUIREMENTS (Gemini 2.5 Flash)")
        phase1_start = time.time()
        client_data = self.audio_processor.process_audio_file(audio_path, language)
        phase1_time = time.time() - phase1_start
        metrics['timings']['phase1_extraction'] = phase1_time
        metrics['api_calls'] += 1
        # Estimate tokens for audio extraction (rough: assume ~5 min audio = ~1500 words = ~2000 tokens)
        metrics['token_counts']['extraction_input'] = 2000  # Estimated audio tokens
        metrics['token_counts']['extraction_output'] = len(str(client_data)) // 4
        print(f"[TIMING] Phase 1: {phase1_time:.2f}s")

        # Convert to ClientRequirements object
        client_req = self._convert_to_client_requirements(client_data)

        # Step 2: Apply hard filters
        print("\n[PHASE 2] APPLYING HARD FILTERS")
        phase2_start = time.time()
        filtered_communities = self.filter_engine._apply_hard_filters(client_req)
        phase2_time = time.time() - phase2_start
        metrics['timings']['phase2_filtering'] = phase2_time
        print(f"[RESULT] {len(filtered_communities)} communities passed hard filters")
        print(f"[TIMING] Phase 2: {phase2_time:.2f}s")

        if filtered_communities.empty:
            print("[WARNING] No communities match the hard filters!")
            total_time = time.time() - e2e_start_time
            print(f"\n[E2E TIMING] Total: {total_time:.2f}s")
            return self._generate_empty_result(client_data)

        # Step 3: Multi-level ranking
        print("\n[PHASE 3] MULTI-LEVEL RANKING ENGINE")
        phase3_start = time.time()
        ranked_communities = self.ranking_engine.rank_communities(
            filtered_communities,
            client_req
        )
        phase3_time = time.time() - phase3_start
        metrics['timings']['phase3_ranking'] = phase3_time
        metrics['api_calls'] += 3  # Availability, Amenity, Holistic AI calls
        # Estimate tokens for ranking (3 AI calls)
        num_communities = len(filtered_communities)
        metrics['token_counts']['ranking_input'] = num_communities * 200  # ~200 tokens per community
        metrics['token_counts']['ranking_output'] = num_communities * 50  # ~50 tokens output per community
        print(f"[TIMING] Phase 3: {phase3_time:.2f}s")

        # Step 4: Generate output
        phase4_start = time.time()
        result = self._generate_output(client_data, client_req, ranked_communities, metrics)
        phase4_time = time.time() - phase4_start
        metrics['timings']['phase4_output'] = phase4_time

        # Calculate E2E time
        e2e_total_time = time.time() - e2e_start_time
        metrics['timings']['e2e_total'] = e2e_total_time

        # Calculate total tokens
        metrics['token_counts']['total_input_tokens'] = (
            metrics['token_counts']['extraction_input'] +
            metrics['token_counts']['ranking_input']
        )
        metrics['token_counts']['total_output_tokens'] = (
            metrics['token_counts']['extraction_output'] +
            metrics['token_counts']['ranking_output']
        )
        metrics['token_counts']['total_tokens'] = (
            metrics['token_counts']['total_input_tokens'] +
            metrics['token_counts']['total_output_tokens']
        )

        # Calculate costs (Gemini 2.5 Flash pricing - 2025)
        # Audio input: $1.00/1M tokens, Output: $2.50/1M tokens
        audio_input_cost = (metrics['token_counts']['extraction_input'] / 1_000_000) * 1.00
        text_input_cost = (metrics['token_counts']['ranking_input'] / 1_000_000) * 0.30
        output_cost = (metrics['token_counts']['total_output_tokens'] / 1_000_000) * 2.50

        total_cost = audio_input_cost + text_input_cost + output_cost

        metrics['costs'] = {
            'audio_input_cost': round(audio_input_cost, 6),
            'text_input_cost': round(text_input_cost, 6),
            'output_cost': round(output_cost, 6),
            'total_cost': round(total_cost, 6),
            'currency': 'USD',
            'pricing_model': 'Gemini 2.5 Flash (2025)',
            'pricing_rates': {
                'audio_input': '$1.00 per 1M tokens',
                'text_input': '$0.30 per 1M tokens',
                'output': '$2.50 per 1M tokens'
            }
        }

        # Print performance summary
        print("\n" + "="*80)
        print("PERFORMANCE METRICS")
        print("="*80)
        print(f"[E2E TIME] Total: {e2e_total_time:.2f}s")
        print(f"  - Phase 1 (Extraction): {phase1_time:.2f}s ({phase1_time/e2e_total_time*100:.1f}%)")
        print(f"  - Phase 2 (Filtering): {phase2_time:.2f}s ({phase2_time/e2e_total_time*100:.1f}%)")
        print(f"  - Phase 3 (Ranking): {phase3_time:.2f}s ({phase3_time/e2e_total_time*100:.1f}%)")
        print(f"  - Phase 4 (Output): {phase4_time:.2f}s ({phase4_time/e2e_total_time*100:.1f}%)")
        print(f"\n[TOKEN COUNT] Total: ~{metrics['token_counts']['total_tokens']:,} tokens")
        print(f"  - Audio Input: ~{metrics['token_counts']['extraction_input']:,} tokens")
        print(f"  - Text Input (Ranking): ~{metrics['token_counts']['ranking_input']:,} tokens")
        print(f"  - Output: ~{metrics['token_counts']['total_output_tokens']:,} tokens")
        print(f"\n[COST BREAKDOWN] Gemini 2.5 Flash (2025 Pricing)")
        print(f"  - Audio Input: ${audio_input_cost:.6f} ({metrics['token_counts']['extraction_input']:,} tokens @ $1.00/1M)")
        print(f"  - Text Input: ${text_input_cost:.6f} ({metrics['token_counts']['ranking_input']:,} tokens @ $0.30/1M)")
        print(f"  - Output: ${output_cost:.6f} ({metrics['token_counts']['total_output_tokens']:,} tokens @ $2.50/1M)")
        print(f"  - TOTAL COST: ${total_cost:.6f}")
        print(f"\n[API CALLS] Gemini API: {metrics['api_calls']} calls")
        print(f"[THROUGHPUT] {metrics['token_counts']['total_tokens'] / e2e_total_time:.0f} tokens/sec")
        print("="*80)

        # Add metrics to result
        result['performance_metrics'] = metrics

        if output_file:
            self._save_results(result, output_file)

        return result

    def process_text_input(self, text: str, output_file: Optional[str] = None) -> dict:
        """
        Process text input and generate ranked recommendations

        Args:
            text: Client conversation text
            output_file: Optional path to save results

        Returns:
            Dict containing client requirements and ranked recommendations
        """
        # Start E2E timer
        e2e_start_time = time.time()

        print("\n" + "="*80)
        print("PROCESSING TEXT INPUT")
        print("="*80)

        # Initialize metrics tracking
        metrics = {
            'timings': {},
            'token_counts': {
                'total_input_tokens': 0,
                'total_output_tokens': 0,
                'total_tokens': 0
            },
            'api_calls': 0
        }

        # Step 1: Extract client requirements from text using Gemini
        print("\n[PHASE 1] EXTRACTING CLIENT REQUIREMENTS (Gemini 2.5 Flash)")
        phase1_start = time.time()
        client_data = self.audio_processor.process_text_input(text)
        phase1_time = time.time() - phase1_start
        metrics['timings']['phase1_extraction'] = phase1_time
        metrics['api_calls'] += 1
        # Estimate tokens for extraction (rough: ~1 token per 4 chars)
        metrics['token_counts']['extraction_input'] = len(text) // 4
        metrics['token_counts']['extraction_output'] = len(str(client_data)) // 4
        print(f"[TIMING] Phase 1: {phase1_time:.2f}s")

        # Convert to ClientRequirements object
        client_req = self._convert_to_client_requirements(client_data)

        # Step 2: Apply hard filters
        print("\n[PHASE 2] APPLYING HARD FILTERS")
        phase2_start = time.time()
        filtered_communities = self.filter_engine._apply_hard_filters(client_req)
        phase2_time = time.time() - phase2_start
        metrics['timings']['phase2_filtering'] = phase2_time
        print(f"[RESULT] {len(filtered_communities)} communities passed hard filters")
        print(f"[TIMING] Phase 2: {phase2_time:.2f}s")

        if filtered_communities.empty:
            print("[WARNING] No communities match the hard filters!")
            total_time = time.time() - e2e_start_time
            print(f"\n[E2E TIMING] Total: {total_time:.2f}s")
            return self._generate_empty_result(client_data)

        # Step 3: Multi-level ranking
        print("\n[PHASE 3] MULTI-LEVEL RANKING ENGINE")
        phase3_start = time.time()
        ranked_communities = self.ranking_engine.rank_communities(
            filtered_communities,
            client_req
        )
        phase3_time = time.time() - phase3_start
        metrics['timings']['phase3_ranking'] = phase3_time
        metrics['api_calls'] += 3  # Availability, Amenity, Holistic AI calls
        # Estimate tokens for ranking (3 AI calls)
        num_communities = len(filtered_communities)
        metrics['token_counts']['ranking_input'] = num_communities * 200  # ~200 tokens per community
        metrics['token_counts']['ranking_output'] = num_communities * 50  # ~50 tokens output per community
        print(f"[TIMING] Phase 3: {phase3_time:.2f}s")

        # Step 4: Generate output
        phase4_start = time.time()
        result = self._generate_output(client_data, client_req, ranked_communities, metrics)
        phase4_time = time.time() - phase4_start
        metrics['timings']['phase4_output'] = phase4_time

        # Calculate E2E time
        e2e_total_time = time.time() - e2e_start_time
        metrics['timings']['e2e_total'] = e2e_total_time

        # Calculate total tokens
        metrics['token_counts']['total_input_tokens'] = (
            metrics['token_counts']['extraction_input'] +
            metrics['token_counts']['ranking_input']
        )
        metrics['token_counts']['total_output_tokens'] = (
            metrics['token_counts']['extraction_output'] +
            metrics['token_counts']['ranking_output']
        )
        metrics['token_counts']['total_tokens'] = (
            metrics['token_counts']['total_input_tokens'] +
            metrics['token_counts']['total_output_tokens']
        )

        # Calculate costs (Gemini 2.5 Flash pricing - 2025)
        # Text input: $0.30/1M tokens, Output: $2.50/1M tokens
        text_extraction_cost = (metrics['token_counts']['extraction_input'] / 1_000_000) * 0.30
        text_ranking_cost = (metrics['token_counts']['ranking_input'] / 1_000_000) * 0.30
        output_cost = (metrics['token_counts']['total_output_tokens'] / 1_000_000) * 2.50

        total_cost = text_extraction_cost + text_ranking_cost + output_cost

        metrics['costs'] = {
            'text_input_cost': round(text_extraction_cost + text_ranking_cost, 6),
            'output_cost': round(output_cost, 6),
            'total_cost': round(total_cost, 6),
            'currency': 'USD',
            'pricing_model': 'Gemini 2.5 Flash (2025)',
            'pricing_rates': {
                'text_input': '$0.30 per 1M tokens',
                'output': '$2.50 per 1M tokens'
            }
        }

        # Print performance summary
        print("\n" + "="*80)
        print("PERFORMANCE METRICS")
        print("="*80)
        print(f"[E2E TIME] Total: {e2e_total_time:.2f}s")
        print(f"  - Phase 1 (Extraction): {phase1_time:.2f}s ({phase1_time/e2e_total_time*100:.1f}%)")
        print(f"  - Phase 2 (Filtering): {phase2_time:.2f}s ({phase2_time/e2e_total_time*100:.1f}%)")
        print(f"  - Phase 3 (Ranking): {phase3_time:.2f}s ({phase3_time/e2e_total_time*100:.1f}%)")
        print(f"  - Phase 4 (Output): {phase4_time:.2f}s ({phase4_time/e2e_total_time*100:.1f}%)")
        print(f"\n[TOKEN COUNT] Total: ~{metrics['token_counts']['total_tokens']:,} tokens")
        print(f"  - Text Input: ~{metrics['token_counts']['total_input_tokens']:,} tokens")
        print(f"  - Output: ~{metrics['token_counts']['total_output_tokens']:,} tokens")
        print(f"\n[COST BREAKDOWN] Gemini 2.5 Flash (2025 Pricing)")
        print(f"  - Text Input: ${text_extraction_cost + text_ranking_cost:.6f} ({metrics['token_counts']['total_input_tokens']:,} tokens @ $0.30/1M)")
        print(f"  - Output: ${output_cost:.6f} ({metrics['token_counts']['total_output_tokens']:,} tokens @ $2.50/1M)")
        print(f"  - TOTAL COST: ${total_cost:.6f}")
        print(f"\n[API CALLS] Gemini API: {metrics['api_calls']} calls")
        print(f"[THROUGHPUT] {metrics['token_counts']['total_tokens'] / e2e_total_time:.0f} tokens/sec")
        print("="*80)

        # Add metrics to result
        result['performance_metrics'] = metrics

        if output_file:
            self._save_results(result, output_file)

        return result

    def update_ranking_weights(self, new_weights: Dict[str, float]):
        """
        Update ranking weights and reinitialize ranking engine

        This allows clients to adjust priorities after seeing initial results

        Args:
            new_weights: Dictionary of dimension names to weights
        """
        print(f"\n[CONFIG] Updating ranking weights: {new_weights}")

        # Update weights
        self.ranking_weights.update(new_weights)

        # Reinitialize ranking engine
        self.ranking_engine = MultiLevelRankingEngine(
            geocoder=self.geocoder,
            weights=self.ranking_weights
        )

        print("[SUCCESS] Ranking weights updated")

    def _convert_to_client_requirements(self, client_data: dict) -> ClientRequirements:
        """Convert extracted data to ClientRequirements object"""
        return ClientRequirements(
            care_level=client_data.get('care_level', 'Independent Living'),
            enhanced=client_data.get('enhanced', False),
            enriched=client_data.get('enriched', False),
            budget=client_data.get('budget', 10000),
            timeline=client_data.get('timeline', 'flexible'),
            location_preference=client_data.get('location_preference', '14604'),
            special_needs=client_data.get('special_needs', {}),
            client_name=client_data.get('client_name'),
            notes=client_data.get('notes')
        )

    def _generate_output(self, client_data: dict, client_req: ClientRequirements,
                        ranked_communities, metrics=None) -> dict:
        """Generate structured output with ranked recommendations"""

        # Export to CRM format
        crm_output = self.ranking_engine.export_to_crm_format(ranked_communities, client_req)

        # Print summary
        print("\n" + "="*80)
        print("RANKING RESULTS")
        print("="*80)

        print(f"\nTOP 3 RECOMMENDATIONS:\n")
        for i, comm in enumerate(ranked_communities[:3], 1):
            print(f"#{i}. Community {comm.community_id}")
            print(f"    Combined Rank Score: {comm.combined_rank_score:.2f} (lower is better)")
            print(f"    Monthly Fee: ${comm.monthly_fee:,.0f}")
            print(f"    Distance: {comm.distance_miles:.2f} miles")
            print(f"    Availability: {comm.est_waitlist}")
            print(f"    Holistic Reason: {comm.holistic_reason}")
            print()

        print("="*80)
        print("STATISTICS")
        print("="*80)
        print(f"  Total Communities Ranked: {len(ranked_communities)}")
        print(f"  Average Monthly Fee: ${crm_output['summary']['avg_monthly_fee']:,.0f}")
        print(f"  Average Distance: {crm_output['summary']['avg_distance_miles']:.2f} miles")
        print("="*80)

        return crm_output

    def _generate_empty_result(self, client_data: dict) -> dict:
        """Generate empty result when no communities match"""
        return {
            "client_info": client_data,
            "ranking_weights": self.ranking_weights,
            "recommendations": [],
            "summary": {
                "total_matches": 0,
                "message": "No communities match the specified criteria. Please adjust requirements."
            }
        }

    def _save_results(self, result: dict, output_file: str):
        """Save results to JSON file"""
        with open(output_file, 'w') as f:
            json.dump(result, f, indent=2, default=str)

        print(f"\n[SAVED] Results saved to: {output_file}")


def test_ranking_pipeline():
    """Test the ranking pipeline with sample text"""
    print("\n" + "="*80)
    print("TESTING MULTI-LEVEL RANKING PIPELINE")
    print("="*80)

    sample_conversation = """
    Consultant: Hello, I'm calling to help you find a senior living community. Can you tell me what type of care you're looking for?

    Client: Hi, yes. My mother needs assisted living. She's 82 and needs help with bathing and taking her medications. She's diabetic and needs some nursing support for her diabetes management.

    Consultant: I understand. What's your budget for monthly costs?

    Client: We can afford around $6,500 per month for the base rent, and we can handle some additional fees if needed.

    Consultant: And when are you looking to move her in?

    Client: Ideally within the next month or two. It's fairly urgent - she had a fall recently and we want to get her into a safer environment soon.

    Consultant: Do you have a preferred location or area?

    Client: We live on the west side of Rochester, so somewhere close to that would be ideal. She also has a small cat that's very important to her. And she prefers a 1-bedroom apartment if possible, but studio would be okay too.

    Consultant: Perfect, that helps a lot. I'll find some good options for you.
    """

    try:
        # Initialize system with equal weights
        system = RankingBasedRecommendationSystem(
            'DataFile_students.xlsx',
            ranking_weights={
                'business': 1.0,
                'cost': 1.0,
                'distance': 1.0,
                'availability': 1.0,
                'budget_efficiency': 1.0,
                'couple': 1.0,
                'amenity': 1.0,
                'holistic': 1.0
            }
        )

        # Process the conversation
        result = system.process_text_input(
            sample_conversation,
            output_file='ranking_recommendations_output.json'
        )

        print("\n" + "="*80)
        print("[SUCCESS] RANKING PIPELINE TEST COMPLETE")
        print("="*80)
        print(f"Total communities ranked: {result['summary']['total_matches']}")
        print(f"Top recommendation: {result['summary'].get('top_recommendation', 'N/A')}")
        print(f"Results saved to: ranking_recommendations_output.json")
        print("="*80)

        return result

    except Exception as e:
        print(f"\n[ERROR] Pipeline test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


def demo_weight_adjustment():
    """Demo showing how to adjust weights based on client priorities"""
    print("\n" + "="*80)
    print("DEMO: ADJUSTING RANKING WEIGHTS")
    print("="*80)

    sample_conversation = """
    Client needs assisted living, budget $5,000/month, immediate placement needed,
    west side of Rochester. Quality of care is most important, location is secondary.
    """

    try:
        # Initialize with equal weights
        system = RankingBasedRecommendationSystem('DataFile_students.xlsx')

        print("\n[SCENARIO 1] Equal Weights (All = 1.0)")
        result1 = system.process_text_input(sample_conversation)
        top1 = result1['recommendations'][0] if result1['recommendations'] else None

        # Adjust weights for quality-focused client
        print("\n[SCENARIO 2] Quality-Focused (Business=2.0, Amenity=2.0, Distance=0.5)")
        system.update_ranking_weights({
            'business': 2.0,   # Prioritize quality partners
            'amenity': 2.0,    # Prioritize amenities
            'holistic': 2.0,   # Trust AI's holistic judgment
            'distance': 0.5    # De-prioritize distance
        })

        # Reprocess with new weights
        result2 = system.process_text_input(sample_conversation)
        top2 = result2['recommendations'][0] if result2['recommendations'] else None

        print("\n" + "="*80)
        print("COMPARISON")
        print("="*80)
        if top1 and top2:
            print(f"Equal Weights Top Pick: Community {top1['community_id']}")
            print(f"Quality-Focused Top Pick: Community {top2['community_id']}")
            if top1['community_id'] != top2['community_id']:
                print("-> Rankings changed based on client priorities!")
            else:
                print("-> Same top pick with different weights")
        print("="*80)

        return result1, result2

    except Exception as e:
        print(f"\n[ERROR] Demo failed: {e}")
        import traceback
        traceback.print_exc()
        return None, None


def demo_audio_processing(audio_file_path: str):
    """
    Demo function for processing actual audio files with ranking system

    Args:
        audio_file_path: Path to the audio file to process
    """
    print("\n" + "="*80)
    print("AUDIO PROCESSING DEMO WITH RANKING")
    print("="*80)

    try:
        # Initialize system
        system = RankingBasedRecommendationSystem('DataFile_students.xlsx')

        # Process the audio file
        result = system.process_audio_file(
            audio_file_path,
            output_file='audio_ranking_recommendations.json'
        )

        print("\n" + "="*80)
        print("[SUCCESS] AUDIO PROCESSING COMPLETE")
        print("="*80)
        print(f"Total communities ranked: {result['summary']['total_matches']}")
        print(f"Top recommendation: {result['summary'].get('top_recommendation', 'N/A')}")
        print(f"Results saved to: audio_ranking_recommendations.json")
        print("="*80)

        return result

    except Exception as e:
        print(f"\n[ERROR] Audio processing failed: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == '__main__':
    # Test with text input
    result = test_ranking_pipeline()

    # Uncomment to demo weight adjustment:
    # result1, result2 = demo_weight_adjustment()

    # Uncomment to test with audio file:
    # result = demo_audio_processing('Calling Transcript.m4a')
