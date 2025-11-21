"""
Gemini 2.5 Flash Audio Processor
Handles direct audio file processing with Gemini's native audio support
"""
import os
import json
from pathlib import Path
from typing import Dict, Any, Optional
from google import genai
from google.genai import types
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class GeminiAudioProcessor:
    """
    Audio processor using Gemini 2.5 Flash
    - Supports direct audio file input (no transcription step needed)
    - Extracts structured client requirements
    - Lightweight and fast
    """

    def __init__(self):
        """Initialize Gemini API"""
        api_key = os.getenv('GEMINI_API_KEY')
        if not api_key:
            raise ValueError(
                "GEMINI_API_KEY not found in environment variables. "
                "Please add it to your .env file"
            )

        # Initialize new Gemini client
        self.client = genai.Client(api_key=api_key)
        self.model_name = 'gemini-2.0-flash-exp'

    def process_audio_file(self, audio_path: str, language: str = 'english') -> Dict[str, Any]:
        """
        Process audio file and extract client requirements
        Gemini 2.5 Flash can handle audio directly

        Args:
            audio_path: Path to audio file (mp3, wav, m4a, etc.)
            language: Language constraint ('english', 'hindi', 'spanish')

        Returns:
            Dict with structured client requirements
        """
        if not os.path.exists(audio_path):
            raise FileNotFoundError(f"Audio file not found: {audio_path}")

        try:
            # Validate file exists and is readable
            file_size = os.path.getsize(audio_path)
            if file_size == 0:
                raise ValueError(f"Audio file is empty: {audio_path}")
            
            # Check file extension
            file_ext = Path(audio_path).suffix.lower()
            supported_extensions = ['.mp3', '.wav', '.m4a', '.ogg', '.webm', '.flac']
            if file_ext not in supported_extensions:
                raise ValueError(
                    f"Unsupported audio format '{file_ext}'. "
                    f"Supported formats: {', '.join(supported_extensions)}"
                )
            
            # Upload audio file to Gemini using new client API
            try:
                audio_file = self.client.files.upload(file=audio_path)
            except Exception as upload_error:
                error_msg = str(upload_error)
                if 'invalid' in error_msg.lower() or 'format' in error_msg.lower() or 'unsupported' in error_msg.lower():
                    raise ValueError(
                        f"Unsupported audio format. Gemini API rejected the file format '{file_ext}'. "
                        f"Please convert your audio file to MP3, WAV, M4A, OGG, WebM, or FLAC format. "
                        f"Original error: {error_msg}"
                    )
                raise

            # Wait for file to become ACTIVE
            import time
            max_wait = 30  # seconds
            waited = 0
            file_state = getattr(audio_file.state, 'name', None) if hasattr(audio_file, 'state') else None
            while file_state != 'ACTIVE' and waited < max_wait:
                time.sleep(1)
                waited += 1
                audio_file = self.client.files.get(name=audio_file.name)
                file_state = getattr(audio_file.state, 'name', None) if hasattr(audio_file, 'state') else None
            
            file_state = getattr(audio_file.state, 'name', None) if hasattr(audio_file, 'state') else None
            if file_state != 'ACTIVE':
                state_str = str(file_state) if file_state is not None else 'unknown'
                raise RuntimeError(f"File did not become ACTIVE after {max_wait}s (state: {state_str})")

            # Generate content with audio + extraction prompt
            extraction_prompt = self._create_extraction_prompt(language)

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=[extraction_prompt, audio_file],
                config=types.GenerateContentConfig(
                    temperature=0.0,  # Zero temperature for maximum consistency
                    response_mime_type="application/json"
                )
            )

            result_text = response.text if hasattr(response, 'text') and response.text else None
            if not result_text:
                raise ValueError("Gemini API returned empty response")
            
            # Clean up markdown code blocks if present
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

            # Handle if Gemini returns a list instead of dict
            if isinstance(parsed, list):
                client_requirements = parsed[0] if parsed else {}
            else:
                client_requirements = parsed

            return client_requirements

        except Exception as e:
            raise RuntimeError(f"Failed to process audio: {str(e)}") from e

    def process_text_input(self, text: str, language: str = 'english') -> Dict[str, Any]:
        """
        Process text input (for testing without audio)

        Args:
            text: Client intake conversation text
            language: Language constraint ('english', 'hindi', 'spanish')

        Returns:
            Dict with structured client requirements
        """
        try:
            extraction_prompt = self._create_extraction_prompt(language)
            full_prompt = extraction_prompt + "\n\nCLIENT CONVERSATION:\n" + text

            response = self.client.models.generate_content(
                model=self.model_name,
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    response_mime_type="application/json"
                )
            )

            result_text = response.text if hasattr(response, 'text') and response.text else None
            if not result_text:
                raise ValueError("Gemini API returned empty response")
            
            parsed = json.loads(result_text)

            # Handle if Gemini returns a list instead of dict
            if isinstance(parsed, list):
                client_requirements = parsed[0] if parsed else {}
            else:
                client_requirements = parsed

            return client_requirements

        except Exception as e:
            raise RuntimeError(f"Failed to process text: {str(e)}") from e

    def _create_extraction_prompt(self, language: str = 'english') -> str:
        """Create the extraction prompt for Gemini"""
        language_instruction = ""
        if language.lower() == 'english':
            language_instruction = "\nLANGUAGE CONSTRAINT: Only process and respond in English. Ignore any other languages spoken in the conversation."
        elif language.lower() == 'hindi':
            language_instruction = "\nLANGUAGE CONSTRAINT: Only process and respond in Hindi. Ignore any other languages spoken in the conversation."
        elif language.lower() == 'spanish':
            language_instruction = "\nLANGUAGE CONSTRAINT: Only process and respond in Spanish. Ignore any other languages spoken in the conversation."

        # Use regular string concatenation instead of f-string to avoid format specifier issues
        prompt = """
You are analyzing a senior living client intake conversation (either audio or text).""" + language_instruction + """
Extract the following information and return it as JSON:

{
  "care_level": "string (must be exactly one of: 'Independent Living', 'Assisted Living', 'Memory Care')",
  "enhanced": "boolean (true if they need Enhanced Assisted Living - higher medical care, nursing support, diabetes management, oxygen, etc.)",
  "enriched": "boolean (true if they need Enriched Housing Program - apartment-style with support services, meals, housekeeping, transportation)",
  "budget": "number (maximum monthly budget in dollars, extract just the number. If not mentioned, use null)",
  "timeline": "string (must be exactly one of: 'immediate', 'near-term', 'flexible')",
  "location_preference": "string (preferred ZIP code as 5-digit string OR city/area description like 'West side of Rochester'. If not mentioned, use null)",
  "special_needs": {
    "pets": "boolean (true if they have pets)",
    "apartment_type_preference": "string (if mentioned, e.g., 'studio', '1 bedroom', '2 bedroom')",
    "other": "string (any other special requirements)"
  },
  "client_name": "string (if mentioned, otherwise null)",
  "notes": "string (any additional important information)"
}

IMPORTANT DEFINITIONS:
- "Independent Living": Client is largely self-sufficient, needs minimal assistance
- "Assisted Living": Client needs help with daily activities (bathing, medication, meals)
- "Memory Care": Client has dementia/Alzheimer's requiring specialized care
- "Enhanced": Higher level medical care with nursing support (diabetes management, oxygen, foley/ostomy, injectable meds, etc.)
- "Enriched": Apartment-style supportive services (meals, housekeeping, transportation)
- "immediate": Needs to move in 0-1 months
- "near-term": Needs to move in 1-6 months
- "flexible": Timeline is 6+ months or unspecified

CRITICAL RULES:
1. For "care_level", use EXACTLY one of the three options listed
2. For "timeline", use EXACTLY one of: "immediate", "near-term", or "flexible"
3. For "budget", extract ONLY the numeric value (no $, no commas)
4. For "location_preference" (IMPORTANT - READ CAREFULLY):
   - **PREFERRED**: Extract 5-digit ZIP code if mentioned (e.g., "14534", "14611", "14618")
   - Look for phrases like "ZIP 14534", "in 14611", "near 14618", "close to ZIP 14534"
   - If ZIP is implied by area name, infer the ZIP code:
     * "Brighton" or "Brighton area" = "14618"
     * "Pittsford" = "14534"
     * "Webster" = "14580"
     * "Penfield" = "14526"
     * "Greece" = "14626"
     * "Downtown Rochester" or "central Rochester" = "14604" (default to downtown)
     * "West Rochester" or "west side" = "14611"
     * "East Rochester" or "east side" = "14618"
     * "Rochester area" or "anywhere in Rochester" or just "Rochester" = "14604" (default to downtown)
     * "anywhere" without city = null
   - If city/area mentioned WITHOUT specific ZIP and not in the list above, use the area description
   - If nothing location-related is mentioned, use null
5. If something is not mentioned, use null (not "unknown" or empty string)
6. Return ONLY valid JSON, no markdown formatting, no extra text

Extract all available information from the conversation.
"""
        return prompt


def test_gemini_processor():
    """Test the Gemini audio processor with sample text"""
    print("="*80)
    print("TESTING GEMINI 2.5 FLASH AUDIO PROCESSOR")
    print("="*80)

    processor = GeminiAudioProcessor()

    # Sample client conversation
    sample_conversation = """
    Consultant: Hello, I'm calling to help you find a senior living community. Can you tell me what type of care you're looking for?

    Client: Hi, yes. My mother needs assisted living. She's 82 and needs help with bathing and taking her medications. She's diabetic and needs some nursing support for her diabetes management.

    Consultant: I understand. What's your budget for monthly costs?

    Client: We can afford around $6,000 per month, maybe a bit more if it's really good.

    Consultant: And when are you looking to move her in?

    Client: Ideally within the next 2-3 months. We'd like to find something soon.

    Consultant: Do you have a preferred location or area?

    Client: We live in the 14534 ZIP code area, so somewhere close to that would be ideal. She also has a small cat that's very important to her.

    Consultant: Perfect, that helps a lot. I'll find some good options for you.
    """

    print("\n" + "-"*80)

    try:
        requirements = processor.process_text_input(sample_conversation)

        print("\n" + "="*80)
        print("EXTRACTED CLIENT REQUIREMENTS:")
        print("="*80)
        print(json.dumps(requirements, indent=2))
        print("="*80)

        return requirements

    except Exception as e:
        print(f"Test failed: {e}")
        import traceback
        traceback.print_exc()
        return None


if __name__ == '__main__':
    test_gemini_processor()
