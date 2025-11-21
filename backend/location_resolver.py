"""
Location Resolver
Converts city/area descriptions to ZIP codes for distance calculations
"""
from geopy.geocoders import Nominatim
from functools import lru_cache
import time
import re


class LocationResolver:
    """
    Resolves location descriptions to ZIP codes
    Handles both explicit ZIP codes and city/area descriptions
    """

    def __init__(self):
        self.geolocator = Nominatim(user_agent="senior_living_location_resolver")
        self._rate_limit_delay = 1.0
        self._last_request_time = 0

        # Common Rochester, NY area mappings
        self.rochester_area_zips = {
            # Central/Downtown
            "downtown rochester": "14604",
            "central rochester": "14604",
            "city center": "14604",

            # West side
            "west side of rochester": "14611",
            "west rochester": "14611",
            "westside": "14611",

            # East side
            "east side of rochester": "14609",
            "east rochester": "14445",  # East Rochester is a separate village
            "eastside": "14609",

            # North side
            "north side of rochester": "14621",
            "north rochester": "14621",
            "northside": "14621",

            # South side
            "south side of rochester": "14620",
            "south rochester": "14620",
            "southside": "14620",

            # Suburbs
            "pittsford": "14534",
            "brighton": "14618",
            "henrietta": "14467",
            "penfield": "14526",
            "webster": "14580",
            "greece": "14626",
            "irondequoit": "14617",
            "fairport": "14450",
            "victor": "14564",
            "canandaigua": "14424",
        }

    def resolve_location(self, location_input: str) -> str:
        """
        Resolve a location input to a ZIP code

        Args:
            location_input: Either a ZIP code or location description

        Returns:
            5-digit ZIP code string, or None if unable to resolve
        """
        if not location_input or location_input == "null":
            return None

        # Already a ZIP code?
        if self._is_zip_code(location_input):
            return location_input[:5]

        # Check our Rochester area mappings first
        normalized = location_input.lower().strip()
        for key, zip_code in self.rochester_area_zips.items():
            if key in normalized:
                print(f"[LOCATION] Resolved '{location_input}' -> {zip_code} (local mapping)")
                return zip_code

        # Try geocoding
        try:
            zip_code = self._geocode_to_zip(location_input)
            if zip_code:
                print(f"[LOCATION] Resolved '{location_input}' -> {zip_code} (geocoding)")
                return zip_code
        except Exception as e:
            print(f"[WARNING] Could not geocode '{location_input}': {e}")

        # Default to Pittsford (common Rochester suburb) if we can't resolve
        print(f"[WARNING] Could not resolve '{location_input}', using Rochester default: 14604")
        return "14604"

    def _is_zip_code(self, text: str) -> bool:
        """Check if text is a 5-digit ZIP code"""
        if not text:
            return False
        # Remove whitespace and check if it's 5 digits
        cleaned = text.strip()
        return bool(re.match(r'^\d{5}$', cleaned))

    @lru_cache(maxsize=100)
    def _geocode_to_zip(self, location_desc: str) -> str:
        """
        Use geocoding to find ZIP code from location description

        Args:
            location_desc: Location description (e.g., "Brighton, NY")

        Returns:
            5-digit ZIP code, or None
        """
        try:
            # Rate limiting
            current_time = time.time()
            time_since_last = current_time - self._last_request_time
            if time_since_last < self._rate_limit_delay:
                time.sleep(self._rate_limit_delay - time_since_last)

            # Add state context if not present
            if " ny" not in location_desc.lower() and " new york" not in location_desc.lower():
                location_desc = f"{location_desc}, New York"

            location = self.geolocator.geocode(location_desc, addressdetails=True, timeout=10)
            self._last_request_time = time.time()

            if location and hasattr(location, 'raw'):
                address = location.raw.get('address', {})
                zip_code = address.get('postcode')

                if zip_code and self._is_zip_code(zip_code):
                    return zip_code[:5]

            return None

        except Exception as e:
            print(f"[WARNING] Geocoding error: {e}")
            return None


# Module-level singleton
_resolver = None


def get_location_resolver() -> LocationResolver:
    """Get or create the singleton location resolver"""
    global _resolver
    if _resolver is None:
        _resolver = LocationResolver()
    return _resolver


def resolve_location(location_input: str) -> str:
    """
    Convenience function to resolve location to ZIP code

    Args:
        location_input: ZIP code or location description

    Returns:
        5-digit ZIP code string
    """
    resolver = get_location_resolver()
    return resolver.resolve_location(location_input)


if __name__ == '__main__':
    # Test location resolution
    print("Testing Location Resolver\n" + "="*80)

    resolver = LocationResolver()

    test_cases = [
        "14534",                      # Direct ZIP
        "West side of Rochester",     # Area description
        "Pittsford",                  # Suburb name
        "Brighton, NY",               # City with state
        "East Rochester",             # Suburb
        "Downtown Rochester",         # Central area
        "14620",                      # Another ZIP
        None,                         # No location
    ]

    for test in test_cases:
        result = resolver.resolve_location(test)
        print(f"  '{test}' -> {result}")
