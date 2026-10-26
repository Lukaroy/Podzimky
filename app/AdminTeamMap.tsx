"use client";

import type * as Leaflet from "leaflet";
import { AlertTriangle, LocateFixed, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type TeamLocation = {
  teamId: string;
  teamName: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updatedAt: string;
};

const REFRESH_INTERVAL_MS = 10_000;

type MapStation = { id: string; title: string; order: number; latitude?: number; longitude?: number };

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Neznámý čas"
    : date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function AdminTeamMap({ stations = [] }: { stations?: MapStation[] }) {
  const [locations, setLocations] = useState<TeamLocation[]>([]);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const markerLayerRef = useRef<Leaflet.LayerGroup | null>(null);
  const currentLocationsRef = useRef(locations);
  const stationsRef = useRef(stations);
  const refreshMarkersRef = useRef<() => void>(() => {});
  const initialFitDoneRef = useRef(false);

  useEffect(() => {
    let isMounted = true;

    void import("leaflet").then((loadedLeaflet) => {
      if (!isMounted || !mapElementRef.current) return;
      const map = loadedLeaflet.map(mapElementRef.current, { scrollWheelZoom: true })
        .setView([49.8, 15.5], 7);
      loadedLeaflet.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
        maxZoom: 17,
        attribution:
          'Mapový podklad &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), data &copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>-přispěvatelé, SRTM',
      }).addTo(map);
      const markerLayer = loadedLeaflet.layerGroup().addTo(map);
      mapRef.current = map;
      markerLayerRef.current = markerLayer;

      refreshMarkersRef.current = () => {
        markerLayer.clearLayers();
        const currentLocations = currentLocationsRef.current;
        const markerBounds: Leaflet.LatLngExpression[] = [];

        for (const station of stationsRef.current) {
          if (station.latitude === undefined || station.longitude === undefined) continue;
          const icon = loadedLeaflet.divIcon({
            className: "admin-station-pin",
            html: "",
            iconSize: [26, 26],
          });
          const pin = loadedLeaflet.marker([station.latitude, station.longitude], { icon });
          const label = loadedLeaflet.DomUtil.create("span");
          label.textContent = `${station.order}. ${station.title}`;
          pin.bindTooltip(label, { direction: "top", offset: [0, -12] });
          pin.addTo(markerLayer);
          markerBounds.push([station.latitude, station.longitude]);
        }

        for (const location of currentLocations) {
          const ageMs = Date.now() - new Date(location.updatedAt).getTime();
          const isStale = !Number.isFinite(ageMs) || ageMs > 120_000;
          const marker = loadedLeaflet.circleMarker([location.latitude, location.longitude], {
            radius: 9,
            color: isStale ? "#76736b" : "#244f42",
            weight: 2,
            fillColor: isStale ? "#aaa69b" : "#5c9b76",
            fillOpacity: 0.95,
          });
          const popup = loadedLeaflet.DomUtil.create("div");
          const name = loadedLeaflet.DomUtil.create("strong", "", popup);
          name.textContent = location.teamName;
          const updated = loadedLeaflet.DomUtil.create("div", "", popup);
          updated.textContent = `Poslední poloha: ${formatUpdatedAt(location.updatedAt)}`;
          if (location.accuracy !== null) {
            const accuracy = loadedLeaflet.DomUtil.create("div", "", popup);
            accuracy.textContent = `Přesnost GPS: přibližně ${Math.round(location.accuracy)} m`;
          }
          const tooltip = loadedLeaflet.DomUtil.create("span");
          tooltip.textContent = location.teamName;
          marker.bindTooltip(tooltip, { permanent: true, direction: "top", offset: [0, -8] });
          marker.bindPopup(popup);
          marker.addTo(markerLayer);
          markerBounds.push([location.latitude, location.longitude]);
        }

        if (!initialFitDoneRef.current && markerBounds.length > 0) {
          if (markerBounds.length === 1) {
            map.setView(markerBounds[0], 16);
          } else {
            map.fitBounds(loadedLeaflet.latLngBounds(markerBounds), { padding: [40, 40], maxZoom: 16 });
          }
          initialFitDoneRef.current = true;
        }
      };
      refreshMarkersRef.current();
    }).catch((mapError: unknown) => {
      if (isMounted) {
        setMapError(mapError instanceof Error ? mapError.message : "Mapu se nepodařilo načíst.");
      }
    });

    return () => {
      isMounted = false;
      refreshMarkersRef.current = () => {};
      markerLayerRef.current?.clearLayers();
      mapRef.current?.remove();
      markerLayerRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    currentLocationsRef.current = locations;
    stationsRef.current = stations;
    refreshMarkersRef.current();
  }, [locations, stations]);

  useEffect(() => {
    let isMounted = true;
    let isRequestInProgress = false;

    const refresh = async () => {
      if (document.visibilityState !== "visible" || isRequestInProgress) return;
      isRequestInProgress = true;
      try {
        const response = await fetch("/api/admin/locations", { cache: "no-store" });
        const result = await response.json() as { locations?: TeamLocation[]; error?: string };
        if (!response.ok || !result.locations) {
          throw new Error(result.error ?? "Polohy týmů se nepodařilo načíst.");
        }
        if (!isMounted) return;
        setLocations(result.locations);
        setLastRefresh(new Date().toISOString());
        setError("");
      } catch (loadError: unknown) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : "Polohy týmů se nepodařilo načíst.");
        }
      } finally {
        isRequestInProgress = false;
        if (isMounted) setIsLoading(false);
      }
    };

    void refresh();
    const interval = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, []);

  const latestLocation = locations.reduce<TeamLocation | null>((latest, location) =>
    !latest || location.updatedAt > latest.updatedAt ? location : latest, null);

  return (
    <section className="admin-team-map-card">
      <header className="admin-team-map-heading">
        <div>
          <p className="admin-eyebrow">Aktuální poloha · bez historie</p>
          <h2>Mapa týmů</h2>
          <p>Turistická mapa s cestami a terénem. Polohy se obnovují každých 10 sekund; starší než 2 minuty jsou neaktuální.</p>
        </div>
        <div className="admin-team-map-count">
          <LocateFixed size={17} />
          {locations.length} {locations.length === 1 ? "tým" : locations.length >= 2 && locations.length <= 4 ? "týmy" : "týmů"}
        </div>
      </header>

      {error && (
        <p role="alert" className="admin-team-map-error">
          <AlertTriangle size={17} /> {error}
        </p>
      )}

      {mapError && (
        <p role="alert" className="admin-team-map-error">
          <AlertTriangle size={17} /> Mapové podklady se nepodařilo načíst: {mapError}
        </p>
      )}

      {!isLoading && locations.length === 0 && !error && (
        <p className="admin-team-map-empty">
          <MapPin size={19} />
          Zatím nemáme polohu žádného týmu. Hráči musí mít otevřenou hru a povolit přístup k poloze.
        </p>
      )}

      <div ref={mapElementRef} className="admin-team-map" aria-label="Mapa aktuálních poloh týmů" />

      <footer className="admin-team-map-footer">
        <span>{latestLocation ? `Poslední poloha přijata ${formatUpdatedAt(latestLocation.updatedAt)}` : "Turistická mapa čeká na první polohu."}</span>
        <span>{lastRefresh ? `Obnoveno ${formatUpdatedAt(lastRefresh)}` : isLoading ? "Načítám polohy…" : "Čekám na polohy týmů…"}</span>
        <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} aria-hidden="true" />
      </footer>
    </section>
  );
}
