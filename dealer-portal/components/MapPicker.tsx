'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker as LeafletMarker, LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Compass, ExternalLink, Locate, Loader2 } from 'lucide-react';

interface MapPickerProps {
  lat?: string | number;
  lng?: string | number;
  onLocationSelect: (loc: {
    lat: string;
    lng: string;
    street?: string;
    city?: string;
    state?: string;
    stateName?: string;
    zip?: string;
    country?: string;
    displayName?: string;
  }) => void;
  className?: string;
}

export function MapPicker({ lat, lng, onLocationSelect, className }: MapPickerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<LeafletMap | null>(null);
  const markerInstance = useRef<LeafletMarker | null>(null);
  const [loadingReverse, setLoadingReverse] = useState(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  const parsedLat = parseFloat(String(lat || ''));
  const parsedLng = parseFloat(String(lng || ''));
  const hasValidCoords = !isNaN(parsedLat) && !isNaN(parsedLng) && (parsedLat !== 0 || parsedLng !== 0);

  // Default fallback center (US geographic center if unset, or default location)
  const defaultCenter: [number, number] = hasValidCoords ? [parsedLat, parsedLng] : [37.2934, -80.0549];
  const defaultZoom = hasValidCoords ? 16 : 13;

  const reverseGeocode = async (lt: number, lg: number) => {
    setLoadingReverse(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lt}&lon=${lg}&addressdetails=1`,
        { headers: { Accept: 'application/json' } },
      );
      if (res.ok) {
        const item = await res.json();
        const a = item.address || {};
        const house = a.house_number ? `${a.house_number} ` : '';
        const street = house + (a.road || a.street || a.pedestrian || a.footway || item.display_name?.split(',')[0] || '');
        const city = a.city || a.town || a.village || a.municipality || a.county || '';
        const stateCode = a['ISO3166-2-lvl4'] ? a['ISO3166-2-lvl4'].split('-')[1] : a.state_code || a.state || '';
        const stateName = a.state || '';
        const zip = a.postcode || '';
        const country = a.country || '';

        onLocationSelect({
          lat: lt.toFixed(6),
          lng: lg.toFixed(6),
          street,
          city,
          state: stateCode,
          stateName,
          zip,
          country,
          displayName: item.display_name || '',
        });
      } else {
        onLocationSelect({ lat: lt.toFixed(6), lng: lg.toFixed(6) });
      }
    } catch {
      onLocationSelect({ lat: lt.toFixed(6), lng: lg.toFixed(6) });
    } finally {
      setLoadingReverse(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (typeof window === 'undefined' || !mapContainer.current) return;

    // Dynamically load leaflet on client to avoid Next.js SSR window errors
    import('leaflet').then((L) => {
      if (!isMounted || !mapContainer.current) return;
      setLeafletLoaded(true);

      const pinIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="transform: translate(-16px, -36px); filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35)); cursor: grab;">
            <svg width="32" height="38" viewBox="0 0 32 38" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 0C7.16344 0 0 7.16344 0 16C0 25.5 16 38 16 38C16 38 32 25.5 32 16C32 7.16344 24.8366 0 16 0Z" fill="#1d4ed8"/>
              <circle cx="16" cy="15" r="6" fill="#ffffff"/>
            </svg>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      // Cleanup existing instance if any
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }

      const map = L.map(mapContainer.current, {
        center: defaultCenter,
        zoom: defaultZoom,
        attributionControl: false,
      });

      mapInstance.current = map;

      // OpenStreetMap Tile Layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);

      // Attribution control in bottom right
      L.control.attribution({ position: 'bottomright', prefix: false }).addTo(map);

      // Add draggable Marker if coords valid
      if (hasValidCoords) {
        const marker = L.marker([parsedLat, parsedLng], {
          icon: pinIcon,
          draggable: true,
        }).addTo(map);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          void reverseGeocode(pos.lat, pos.lng);
        });

        markerInstance.current = marker;
      }

      // Click on map sets/moves marker and reverse geocodes
      map.on('click', (e: LeafletMouseEvent) => {
        const { lat: clickLat, lng: clickLng } = e.latlng;
        if (markerInstance.current) {
          markerInstance.current.setLatLng([clickLat, clickLng]);
        } else {
          const marker = L.marker([clickLat, clickLng], {
            icon: pinIcon,
            draggable: true,
          }).addTo(map);

          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            void reverseGeocode(pos.lat, pos.lng);
          });

          markerInstance.current = marker;
        }
        void reverseGeocode(clickLat, clickLng);
      });
    });

    return () => {
      isMounted = false;
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update marker position and center map when props change
  useEffect(() => {
    if (!mapInstance.current || !hasValidCoords) return;
    import('leaflet').then((L) => {
      const pinIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div style="transform: translate(-16px, -36px); filter: drop-shadow(0 3px 6px rgba(0,0,0,0.35)); cursor: grab;">
            <svg width="32" height="38" viewBox="0 0 32 38" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 0C7.16344 0 0 7.16344 0 16C0 25.5 16 38 16 38C16 38 32 25.5 32 16C32 7.16344 24.8366 0 16 0Z" fill="#1d4ed8"/>
              <circle cx="16" cy="15" r="6" fill="#ffffff"/>
            </svg>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      if (markerInstance.current) {
        markerInstance.current.setLatLng([parsedLat, parsedLng]);
      } else {
        const marker = L.marker([parsedLat, parsedLng], {
          icon: pinIcon,
          draggable: true,
        }).addTo(mapInstance.current);

        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          void reverseGeocode(pos.lat, pos.lng);
        });

        markerInstance.current = marker;
      }

      mapInstance.current.panTo([parsedLat, parsedLng], { animate: true, duration: 0.8 });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedLat, parsedLng, hasValidCoords]);

  const locateMe = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const myLat = pos.coords.latitude;
        const myLng = pos.coords.longitude;
        if (mapInstance.current) {
          mapInstance.current.setView([myLat, myLng], 16, { animate: true });
        }
        if (markerInstance.current) {
          markerInstance.current.setLatLng([myLat, myLng]);
        }
        void reverseGeocode(myLat, myLng);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000 },
    );
  };

  const gmapsDirUrl = hasValidCoords ? `https://www.google.com/maps/dir/?api=1&destination=${parsedLat},${parsedLng}` : '';
  const osmDirUrl = hasValidCoords ? `https://www.openstreetmap.org/directions?to=${parsedLat}%2C${parsedLng}` : '';

  return (
    <div className={className || 'space-y-2'}>
      {/* Map Header with quick controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-slate-600">
          <span className="font-semibold text-slate-700">OpenStreetMap Interactive Pin</span>
          {loadingReverse ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-blue-600">
              <Loader2 className="h-3 w-3 animate-spin" /> Setting address…
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">· Click or drag pin to set exact address</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={locateMe}
            title="Pin current location"
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Locate className="h-3 w-3 text-blue-600" />
            Locate me
          </button>
          {hasValidCoords && (
            <>
              <a
                href={gmapsDirUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Compass className="h-3 w-3 text-blue-600" />
                Directions
              </a>
              <a
                href={osmDirUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                <ExternalLink className="h-3 w-3 text-emerald-600" />
                OSM
              </a>
            </>
          )}
        </div>
      </div>

      {/* Leaflet Map Box */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner">
        <div ref={mapContainer} className="h-56 w-full sm:h-64 z-0" />
        {!leafletLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-100/90 text-xs text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin text-blue-600" />
            Loading OpenStreetMap with Leaflet…
          </div>
        )}
      </div>
    </div>
  );
}
