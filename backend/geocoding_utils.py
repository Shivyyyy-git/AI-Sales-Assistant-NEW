"""
Geocoding utilities for calculating distances between ZIP codes
Uses geopy with caching for performance
"""
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
from functools import lru_cache
import time


class ZipCodeGeocoder:
    """
    Geocode ZIP codes and calculate distances using real lat/lon coordinates
    """

    def __init__(self, use_real_geocoding=True):
        # Initialize Nominatim geocoder with a user agent
        self.geolocator = Nominatim(user_agent="senior_living_community_matcher")
        self._rate_limit_delay = 1.0  # Nominatim requires 1 second between requests
        self._last_request_time = 0
        self.use_real_geocoding = use_real_geocoding  # Can disable for testing

    @lru_cache(maxsize=1000)
    def get_coordinates(self, zip_code: str) -> tuple:
        """
        Get latitude and longitude for a ZIP code (cached)

        Args:
            zip_code: US ZIP code (5 digits)

        Returns:
            (latitude, longitude) tuple, or None if not found
        """
        try:
            # Clean ZIP code - handle float values from Excel (e.g., '14526.0')
            zip_str = str(zip_code).strip()
            # Remove .0 suffix if present
            if '.' in zip_str:
                zip_str = zip_str.split('.')[0]
            if len(zip_str) > 5:
                zip_str = zip_str[:5]

            # Rate limiting to respect Nominatim usage policy
            current_time = time.time()
            time_since_last = current_time - self._last_request_time
            if time_since_last < self._rate_limit_delay:
                time.sleep(self._rate_limit_delay - time_since_last)

            # Geocode the ZIP code
            location = self.geolocator.geocode(f"{zip_str}, USA", timeout=10)
            self._last_request_time = time.time()

            if location:
                return (location.latitude, location.longitude)
            else:
                return None

        except Exception as e:
            print(f"[WARNING] Geocoding failed for ZIP {zip_code}: {e}")
            return None

    def calculate_distance(self, zip1: str, zip2: str) -> float:
        """
        Calculate distance in miles between two ZIP codes

        Args:
            zip1: First ZIP code
            zip2: Second ZIP code

        Returns:
            Distance in miles, or 9999 if geocoding fails
        """
        try:
            # Clean ZIP codes - handle float values from Excel
            z1 = str(zip1).strip()
            z2 = str(zip2).strip()
            if '.' in z1:
                z1 = z1.split('.')[0]
            if '.' in z2:
                z2 = z2.split('.')[0]

            # If real geocoding disabled (for testing), use fallback immediately
            if not self.use_real_geocoding:
                return self._fallback_distance(z1, z2)

            coords1 = self.get_coordinates(z1)
            coords2 = self.get_coordinates(z2)

            if coords1 is None or coords2 is None:
                # Fallback to simple numeric difference
                fallback_dist = self._fallback_distance(z1, z2)
                return fallback_dist

            # Calculate geodesic distance (accounts for Earth's curvature)
            distance = geodesic(coords1, coords2).miles

            return round(distance, 2)

        except Exception as e:
            print(f"[WARNING] Distance calculation failed: {e}")
            return self._fallback_distance(z1, z2)

    def _fallback_distance(self, zip1: str, zip2: str) -> float:
        """
        Fallback distance calculation using simple numeric difference
        This is very rough but better than returning 9999

        ZIP code prefixes roughly correspond to geographic regions:
        - First digit: broad geographic area (0=northeast, 9=west)
        - First 3 digits: sectional center facility

        We use a weighted approach:
        - First digit difference * 500 miles (cross-country estimate)
        - Next two digits difference * 10 miles (regional estimate)
        """
        try:
            # Clean ZIP codes - handle float values from Excel
            z1 = str(zip1).strip()
            z2 = str(zip2).strip()
            # Remove .0 suffix if present
            if '.' in z1:
                z1 = z1.split('.')[0]
            if '.' in z2:
                z2 = z2.split('.')[0]
            z1 = z1[:5]
            z2 = z2[:5]

            if len(z1) >= 3 and len(z2) >= 3:
                # First digit difference (0-9 range = ~3000 miles coast to coast)
                first_digit_diff = abs(int(z1[0]) - int(z2[0])) * 500

                # Three digit prefix difference (regional)
                prefix_diff = abs(int(z1[:3]) - int(z2[:3])) * 10

                # Combine estimates
                estimated_distance = first_digit_diff + prefix_diff

                return min(estimated_distance, 9999)  # Cap at 9999
            else:
                return 9999

        except Exception:
            return 9999

    def batch_calculate_distances(self, zip_codes: list, reference_zip: str) -> dict:
        """
        Calculate distances from multiple ZIP codes to a reference ZIP
        More efficient for bulk operations

        Args:
            zip_codes: List of ZIP codes to calculate distances from
            reference_zip: Reference ZIP code

        Returns:
            Dictionary mapping zip_code -> distance
        """
        results = {}

        # Get reference coordinates once
        ref_coords = self.get_coordinates(reference_zip)

        for zip_code in zip_codes:
            if ref_coords is None:
                results[zip_code] = self._fallback_distance(zip_code, reference_zip)
            else:
                coords = self.get_coordinates(zip_code)

                if coords is None:
                    results[zip_code] = self._fallback_distance(zip_code, reference_zip)
                else:
                    try:
                        distance = geodesic(ref_coords, coords).miles
                        results[zip_code] = round(distance, 2)
                    except Exception:
                        results[zip_code] = self._fallback_distance(zip_code, reference_zip)

        return results


# Module-level instance for easy imports
_geocoder = None

def get_geocoder() -> ZipCodeGeocoder:
    """Get or create the singleton geocoder instance"""
    global _geocoder
    if _geocoder is None:
        _geocoder = ZipCodeGeocoder()
    return _geocoder


def calculate_zip_distance(zip1: str, zip2: str) -> float:
    """
    Convenience function to calculate distance between two ZIP codes

    Args:
        zip1: First ZIP code
        zip2: Second ZIP code

    Returns:
        Distance in miles
    """
    geocoder = get_geocoder()
    return geocoder.calculate_distance(zip1, zip2)


if __name__ == '__main__':
    # Test the geocoding
    print("Testing ZIP Code Geocoding\n" + "="*80)

    geocoder = ZipCodeGeocoder()

    # Test 1: Rochester, NY area ZIPs
    print("\nTest 1: Rochester, NY area")
    zip1 = "14534"  # Pittsford
    zip2 = "14619"  # Rochester

    coords1 = geocoder.get_coordinates(zip1)
    coords2 = geocoder.get_coordinates(zip2)

    print(f"  {zip1}: {coords1}")
    print(f"  {zip2}: {coords2}")

    distance = geocoder.calculate_distance(zip1, zip2)
    print(f"  Distance: {distance} miles")

    # Test 2: Different cities
    print("\nTest 2: Cross-city distances")
    test_pairs = [
        ("14534", "14626"),  # Pittsford to Rochester west side
        ("14534", "14456"),  # Pittsford to another NY area
        ("14534", "10001"),  # Rochester to NYC
    ]

    for z1, z2 in test_pairs:
        dist = geocoder.calculate_distance(z1, z2)
        print(f"  {z1} to {z2}: {dist} miles")

    # Test 3: Batch calculation
    print("\nTest 3: Batch calculation")
    zip_list = ["14619", "14626", "14615", "14609", "14467"]
    reference = "14534"

    results = geocoder.batch_calculate_distances(zip_list, reference)
    print(f"  Distances from {reference}:")
    for zip_code, dist in sorted(results.items(), key=lambda x: x[1]):
        print(f"    {zip_code}: {dist} miles")
