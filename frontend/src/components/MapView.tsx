
import React, { useEffect, useRef } from 'react';
import { Community } from '../types';

// Since we are not using a bundler with types for Leaflet,
// we need to declare the 'L' global variable to satisfy TypeScript.
declare const L: any;

interface MapViewProps {
  communities: Community[];
}

const MapView: React.FC<MapViewProps> = ({ communities }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any | null>(null);
  const markersRef = useRef<any[]>([]);

  // Initialize map effect
  useEffect(() => {
    if (mapContainerRef.current && !mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current, {
        zoomControl: false // Disable default zoom control
      }).setView([37.7749, -122.4194], 9); // Centered on SF Bay Area

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(mapRef.current);

      L.control.zoom({
        position: 'bottomright'
      }).addTo(mapRef.current);
    }
  }, []);

  // Update markers when communities change
  useEffect(() => {
    if (!mapRef.current) return;

    // Clear existing markers
    markersRef.current.forEach(marker => marker.remove());
    markersRef.current = [];

    const communityCoords: [number, number][] = [];

    communities.forEach(community => {
      if (community) {
        const coords: [number, number] = [community.lat, community.lng];
        communityCoords.push(coords);

        const popupContent = `
          <div style="font-family: Inter, sans-serif; font-size: 14px; color: #2d3748;">
            <h3 style="font-weight: 700; margin: 0 0 4px 0; color: #1a202c;">${community.name}</h3>
            <p style="margin: 0;">${community.address}</p>
          </div>
        `;
        
        const marker = L.marker(coords)
          .addTo(mapRef.current)
          .bindPopup(popupContent);
        
        markersRef.current.push(marker);
      }
    });

    // Adjust map view to fit all markers
    if (communityCoords.length > 0) {
      mapRef.current.fitBounds(communityCoords, { padding: [50, 50], maxZoom: 14 });
    } else {
       // If no recommendations, reset to default view
       mapRef.current.setView([37.7749, -122.4194], 9);
    }
  }, [communities]);

  return <div ref={mapContainerRef} className="leaflet-container" />;
};

export default MapView;
