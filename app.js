/**
 * Where Did I Park? (Campus Parking)
 * Modular ES6+ application logic with Leaflet.js, Geolocation API,
 * HTML5 Canvas photo compression, and resilient localStorage persistence.
 */

(() => {
  "use strict";

  /* ========================================================================
     1. Constants & Configuration
     ======================================================================== */
  const STORAGE_KEYS = Object.freeze({
    THEME: "wdip_theme_v1",
    ACTIVE_SPOT: "wdip_active_spot_v1",
    HISTORY: "wdip_history_v1",
  });

  const DEFAULT_CAMPUS_COORDS = Object.freeze({
    lat: 31.2554,
    lng: 75.7049,
  });

  const PRESET_ZONES = new Set([
    "Main Gate",
    "Academic Block 34",
    "Central Library",
    "Hostel Zone",
    "Sports Complex",
  ]);

  const PRESET_TIMERS = new Set([0, 30, 60, 120, 240]);
  const WALKING_SPEED_MPS = 1.35; // ~4.86 km/h average campus walk
  const MAX_HISTORY_ITEMS = 30;
  const PHOTO_MAX_DIMENSION = 900;
  const PHOTO_QUALITY = 0.72;

  /* ========================================================================
     2. Storage Service (Error-free localStorage wrapper)
     ======================================================================== */
  const StorageService = {
    isAvailable() {
      try {
        const testKey = "__wdip_test__";
        window.localStorage.setItem(testKey, "1");
        window.localStorage.removeItem(testKey);
        return true;
      } catch {
        return false;
      }
    },

    getString(key, fallback = null) {
      try {
        const val = window.localStorage.getItem(key);
        return val !== null ? val : fallback;
      } catch {
        return fallback;
      }
    },

    setString(key, value) {
      try {
        window.localStorage.setItem(key, value);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err };
      }
    },

    getJSON(key, fallback = null) {
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return fallback;
        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
      } catch {
        return fallback;
      }
    },

    setJSON(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err };
      }
    },

    remove(key) {
      try {
        window.localStorage.removeItem(key);
        return true;
      } catch {
        return false;
      }
    },
  };

  /* ========================================================================
     3. Geo, Formatting & Math Helpers
     ======================================================================== */
  const GeoMath = {
    toRad(deg) {
      return (deg * Math.PI) / 180;
    },

    toDeg(rad) {
      return (rad * 180) / Math.PI;
    },

    haversineMeters(lat1, lng1, lat2, lng2) {
      const R = 6371000;
      const dLat = this.toRad(lat2 - lat1);
      const dLng = this.toRad(lng2 - lng1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(this.toRad(lat1)) *
          Math.cos(this.toRad(lat2)) *
          Math.sin(dLng / 2) ** 2;
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    },

    bearingDegrees(lat1, lng1, lat2, lng2) {
      const phi1 = this.toRad(lat1);
      const phi2 = this.toRad(lat2);
      const dLambda = this.toRad(lng2 - lng1);
      const y = Math.sin(dLambda) * Math.cos(phi2);
      const x =
        Math.cos(phi1) * Math.sin(phi2) -
        Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
      return (this.toDeg(Math.atan2(y, x)) + 360) % 360;
    },

    cardinalDirection(deg) {
      const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
      return dirs[Math.round(deg / 45) % 8];
    },

    formatCoords(lat, lng) {
      return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    },

    formatDistance(meters) {
      if (!Number.isFinite(meters)) return "—";
      if (meters < 1000) return `${Math.round(meters)} m`;
      return `${(meters / 1000).toFixed(2)} km`;
    },

    formatWalkingTime(meters) {
      if (!Number.isFinite(meters)) return "Waiting for GPS…";
      if (meters < 25) return "Right next to your vehicle";
      const mins = Math.max(1, Math.round(meters / WALKING_SPEED_MPS / 60));
      return `~${mins} min walk`;
    },

    formatDuration(ms) {
      const totalSecs = Math.max(0, Math.floor(ms / 1000));
      const days = Math.floor(totalSecs / 86400);
      const hrs = Math.floor((totalSecs % 86400) / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      const secs = totalSecs % 60;
      const pad = (n) => String(n).padStart(2, "0");
      const hms = `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
      return days > 0 ? `${days}d ${hms}` : hms;
    },

    formatTimestamp(ts) {
      try {
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(ts));
      } catch {
        return new Date(ts).toLocaleString();
      }
    },

    formatBytes(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      return `${(bytes / 1024).toFixed(1)} KB`;
    },
  };

  /* ========================================================================
     4. HTML5 Canvas Image Compressor
     ======================================================================== */
  const ImageCompressor = {
    compress(file, maxDim = PHOTO_MAX_DIMENSION, quality = PHOTO_QUALITY) {
      return new Promise((resolve, reject) => {
        if (!file || !file.type.startsWith("image/")) {
          reject(new Error("Please choose a valid image file."));
          return;
        }

        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read image file."));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error("Could not decode image."));
          img.onload = () => {
            let { width, height } = img;
            if (width > maxDim || height > maxDim) {
              const ratio = Math.min(maxDim / width, maxDim / height);
              width = Math.round(width * ratio);
              height = Math.round(height * ratio);
            }

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Canvas compression unavailable."));
              return;
            }

            ctx.drawImage(img, 0, 0, width, height);
            let dataUrl = canvas.toDataURL("image/jpeg", quality);

            // Second-pass compression if still large for localStorage
            if (dataUrl.length > 260_000) {
              dataUrl = canvas.toDataURL("image/jpeg", 0.55);
            }

            const approxBytes = Math.round((dataUrl.length * 3) / 4);
            resolve({
              dataUrl,
              originalBytes: file.size,
              compressedBytes: approxBytes,
              width,
              height,
            });
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    },
  };

  /* ========================================================================
     5. Application State
     ======================================================================== */
  const state = {
    theme: "light",
    activeSpot: null,
    history: [],
    isUpdating: false,

    // Form selections
    selectedZone: "Main Gate",
    selectedVehicle: "Two-Wheeler/Bike",
    selectedTimerMinutes: 0,
    pinCoords: { ...DEFAULT_CAMPUS_COORDS },
    pinManuallyMoved: false,
    pendingPhotoDataUrl: null,

    // Live GPS & Compass
    userCoords: null, // { lat, lng, accuracy }
    gpsStatus: "searching", // searching | locked | manual | error
    watchId: null,
    deviceHeading: null,
    hasLiveCompass: false,

    // Timers & Alert Flags
    tickIntervalId: null,
    warnAlertFired: false,
    expiredAlertFired: false,
    clearHistoryArmed: false,
    clearHistoryTimeoutId: null,

    // Leaflet Instances
    saveMap: null,
    saveMarker: null,
    saveUserCircle: null,
    liveMap: null,
    liveVehicleMarker: null,
    liveUserMarker: null,
    liveAccuracyCircle: null,
    livePolyline: null,
    liveMapFittedOnce: false,
  };

  /* ========================================================================
     6. DOM References
     ======================================================================== */
  const dom = {};

  function cacheDom() {
    const ids = [
      "gps-status-pill",
      "gps-status-text",
      "theme-toggle",
      "theme-icon",
      "toast-container",
      "save-spot-screen",
      "save-screen-heading",
      "save-screen-subtitle",
      "cancel-update-btn",
      "recenter-gps-btn",
      "gps-fallback-banner",
      "gps-fallback-message",
      "save-map",
      "save-map-fallback",
      "selected-coords-display",
      "pin-hint-text",
      "parking-form",
      "zone-pills",
      "custom-zone-wrap",
      "custom-zone-input",
      "vehicle-pills",
      "floor-input",
      "slot-input",
      "pillar-input",
      "notes-input",
      "photo-input",
      "remove-photo-btn",
      "photo-meta",
      "photo-preview-wrap",
      "photo-preview-img",
      "timer-pills",
      "custom-timer-wrap",
      "custom-timer-input",
      "save-spot-btn",
      "save-spot-btn-text",
      "active-dashboard-screen",
      "dash-vehicle-badge",
      "dash-saved-at",
      "update-spot-btn",
      "end-session-btn",
      "reminder-alert-banner",
      "reminder-alert-text",
      "elapsed-timer-value",
      "countdown-card",
      "countdown-value",
      "countdown-sub",
      "distance-value",
      "walking-time-value",
      "compass-arrow",
      "bearing-value",
      "compass-mode-sub",
      "fit-route-btn",
      "live-map",
      "live-map-fallback",
      "google-maps-link",
      "dash-zone-pill",
      "dash-floor",
      "dash-slot",
      "dash-pillar",
      "dash-notes",
      "dash-coords",
      "dash-photo-section",
      "dash-photo-trigger",
      "dash-photo-img",
      "history-details",
      "history-count-badge",
      "clear-history-btn",
      "history-empty-state",
      "history-list",
      "photo-modal",
      "photo-modal-backdrop",
      "close-photo-modal",
      "modal-photo-img",
    ];
    ids.forEach((id) => {
      dom[id] = document.getElementById(id);
    });
  }

  /* ========================================================================
     7. UI Feedback (Toasts, Theme, GPS Pill)
     ======================================================================== */
  function showToast(message, durationMs = 3200) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    dom["toast-container"].appendChild(toast);

    window.setTimeout(() => {
      toast.remove();
    }, durationMs);
  }

  function applyTheme(theme) {
    state.theme = theme === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", state.theme);
    const isDark = state.theme === "dark";
    dom["theme-icon"].textContent = isDark ? "☀️" : "🌙";
    dom["theme-toggle"].querySelector(".theme-label").textContent = isDark ? "Light" : "Dark";
    dom["theme-toggle"].setAttribute("aria-pressed", String(isDark));
    dom["theme-toggle"].setAttribute(
      "aria-label",
      isDark ? "Switch to light mode" : "Switch to dark mode"
    );
    StorageService.setString(STORAGE_KEYS.THEME, state.theme);
  }

  function initTheme() {
    const saved = StorageService.getString(STORAGE_KEYS.THEME);
    if (saved === "light" || saved === "dark") {
      applyTheme(saved);
      return;
    }
    const prefersDark =
      window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyTheme(prefersDark ? "dark" : "light");
  }

  function setGpsPill(status, text) {
    state.gpsStatus = status;
    const pill = dom["gps-status-pill"];
    pill.className = `gps-pill gps-pill--${status}`;
    dom["gps-status-text"].textContent = text;
  }

  /* ========================================================================
     8. Leaflet Map Helpers
     ======================================================================== */
  function isLeafletReady() {
    return typeof window.L !== "undefined";
  }

  function createVehicleIcon(vehicleType) {
    const emoji =
      vehicleType === "Car"
        ? "🚗"
        : vehicleType === "EV/Bicycle"
          ? "🚲"
          : "🏍️";
    return window.L.divIcon({
      className: "custom-pin-icon",
      html: `<div class="vehicle-marker-badge"><span>${emoji}</span></div>`,
      iconSize: [36, 42],
      iconAnchor: [18, 38],
      popupAnchor: [0, -34],
    });
  }

  function createUserIcon() {
    return window.L.divIcon({
      className: "custom-pin-icon",
      html: `<div class="user-marker-pulse"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function addOsmLayer(map) {
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
  }

  function initSaveMap() {
    if (!isLeafletReady()) {
      dom["save-map"].classList.add("hidden");
      dom["save-map-fallback"].classList.remove("hidden");
      return;
    }

    if (state.saveMap) {
      state.saveMap.invalidateSize();
      return;
    }

    const { lat, lng } = state.pinCoords;
    const map = window.L.map(dom["save-map"], {
      center: [lat, lng],
      zoom: 17,
      zoomControl: true,
    });
    addOsmLayer(map);

    const marker = window.L.marker([lat, lng], {
      draggable: true,
      icon: createVehicleIcon(state.selectedVehicle),
    }).addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      updateSavePin(pos.lat, pos.lng, { manual: true, panMap: false });
    });

    map.on("click", (e) => {
      updateSavePin(e.latlng.lat, e.latlng.lng, { manual: true, panMap: false });
    });

    state.saveMap = map;
    state.saveMarker = marker;
    updateCoordsDisplay();
  }

  function updateSavePin(lat, lng, { manual = false, panMap = true } = {}) {
    state.pinCoords = { lat, lng };
    if (manual) {
      state.pinManuallyMoved = true;
    }

    if (state.saveMarker) {
      state.saveMarker.setLatLng([lat, lng]);
    }
    if (state.saveMap && panMap) {
      state.saveMap.setView([lat, lng], Math.max(state.saveMap.getZoom(), 17), {
        animate: true,
      });
    }
    updateCoordsDisplay();
  }

  function refreshSaveMarkerIcon() {
    if (state.saveMarker && isLeafletReady()) {
      state.saveMarker.setIcon(createVehicleIcon(state.selectedVehicle));
    }
  }

  function updateCoordsDisplay() {
    dom["selected-coords-display"].textContent = GeoMath.formatCoords(
      state.pinCoords.lat,
      state.pinCoords.lng
    );
  }

  function initLiveMap() {
    if (!state.activeSpot) return;
    if (!isLeafletReady()) {
      dom["live-map"].classList.add("hidden");
      dom["live-map-fallback"].classList.remove("hidden");
      return;
    }

    const { lat, lng, vehicleType, zone } = state.activeSpot;

    if (!state.liveMap) {
      const map = window.L.map(dom["live-map"], {
        center: [lat, lng],
        zoom: 17,
      });
      addOsmLayer(map);
      state.liveMap = map;
    } else {
      state.liveMap.invalidateSize();
    }

    if (!state.liveVehicleMarker) {
      state.liveVehicleMarker = window.L.marker([lat, lng], {
        icon: createVehicleIcon(vehicleType),
      }).addTo(state.liveMap);
    } else {
      state.liveVehicleMarker.setLatLng([lat, lng]);
      state.liveVehicleMarker.setIcon(createVehicleIcon(vehicleType));
    }
    state.liveVehicleMarker.bindPopup(`<strong>${escapeHtml(zone)}</strong><br/>${escapeHtml(vehicleType)}`);

    state.liveMapFittedOnce = false;
    updateLiveTrackingOverlay();
  }

  function updateLiveTrackingOverlay() {
    if (!state.activeSpot) return;

    const spot = state.activeSpot;
    if (!state.userCoords) {
      dom["distance-value"].textContent = "—";
      dom["walking-time-value"].textContent =
        state.gpsStatus === "error" || state.gpsStatus === "manual"
          ? "Enable GPS for live distance"
          : "Locating you…";
      dom["bearing-value"].textContent = "—";
      return;
    }

    const { lat: uLat, lng: uLng, accuracy } = state.userCoords;
    const distance = GeoMath.haversineMeters(uLat, uLng, spot.lat, spot.lng);
    const bearing = GeoMath.bearingDegrees(uLat, uLng, spot.lat, spot.lng);
    const cardinal = GeoMath.cardinalDirection(bearing);

    dom["distance-value"].textContent = GeoMath.formatDistance(distance);
    dom["walking-time-value"].textContent = GeoMath.formatWalkingTime(distance);

    updateCompassUI(bearing, cardinal);

    if (!state.liveMap || !isLeafletReady()) return;

    if (!state.liveUserMarker) {
      state.liveUserMarker = window.L.marker([uLat, uLng], {
        icon: createUserIcon(),
      })
        .addTo(state.liveMap)
        .bindPopup("You are here");
    } else {
      state.liveUserMarker.setLatLng([uLat, uLng]);
    }

    if (!state.liveAccuracyCircle) {
      state.liveAccuracyCircle = window.L.circle([uLat, uLng], {
        radius: Math.min(accuracy || 15, 120),
        color: "#2563eb",
        fillColor: "#3b82f6",
        fillOpacity: 0.12,
        weight: 1,
      }).addTo(state.liveMap);
    } else {
      state.liveAccuracyCircle.setLatLng([uLat, uLng]);
      state.liveAccuracyCircle.setRadius(Math.min(accuracy || 15, 120));
    }

    const linePoints = [
      [uLat, uLng],
      [spot.lat, spot.lng],
    ];
    if (!state.livePolyline) {
      state.livePolyline = window.L.polyline(linePoints, {
        color: "#2563eb",
        weight: 4,
        dashArray: "8, 8",
        opacity: 0.85,
      }).addTo(state.liveMap);
    } else {
      state.livePolyline.setLatLngs(linePoints);
    }

    if (!state.liveMapFittedOnce) {
      fitLiveMapBounds();
      state.liveMapFittedOnce = true;
    }
  }

  function fitLiveMapBounds() {
    if (!state.liveMap || !state.activeSpot || !isLeafletReady()) return;
    const { lat, lng } = state.activeSpot;

    if (state.userCoords) {
      const bounds = window.L.latLngBounds([
        [state.userCoords.lat, state.userCoords.lng],
        [lat, lng],
      ]);
      state.liveMap.fitBounds(bounds, { padding: [46, 46], maxZoom: 18 });
    } else {
      state.liveMap.setView([lat, lng], 17);
    }
  }

  function updateCompassUI(bearing, cardinal) {
    const roundedBearing = Math.round(bearing);
    dom["bearing-value"].textContent = `${cardinal} (${roundedBearing}°)`;

    if (state.hasLiveCompass && state.deviceHeading !== null) {
      const relativeAngle = (bearing - state.deviceHeading + 360) % 360;
      dom["compass-arrow"].style.transform = `rotate(${relativeAngle}deg)`;
      dom["compass-mode-sub"].textContent = "Live compass relative to phone";
    } else {
      dom["compass-arrow"].style.transform = `rotate(${roundedBearing}deg)`;
      dom["compass-mode-sub"].textContent = "Direction from North";
    }
  }

  /* ========================================================================
     9. Geolocation & Device Compass
     ======================================================================== */
  function requestInitialGps({ recenterPin = false } = {}) {
    if (!("geolocation" in navigator)) {
      setGpsPill("error", "GPS Unsupported");
      showGpsFallback("Geolocation is not supported by this browser. Tap or drag the map pin manually.");
      return;
    }

    setGpsPill("searching", "Locating GPS…");

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        state.userCoords = { lat: latitude, lng: longitude, accuracy };
        setGpsPill("locked", `GPS Locked (±${Math.round(accuracy)}m)`);
        dom["gps-fallback-banner"].classList.add("hidden");

        if (recenterPin || !state.pinManuallyMoved) {
          updateSavePin(latitude, longitude, { manual: false, panMap: true });
        }

        if (state.saveMap && isLeafletReady()) {
          if (!state.saveUserCircle) {
            state.saveUserCircle = window.L.circle([latitude, longitude], {
              radius: Math.min(accuracy, 100),
              color: "#2563eb",
              fillColor: "#3b82f6",
              fillOpacity: 0.14,
              weight: 1,
            }).addTo(state.saveMap);
          } else {
            state.saveUserCircle.setLatLng([latitude, longitude]);
            state.saveUserCircle.setRadius(Math.min(accuracy, 100));
          }
        }

        updateLiveTrackingOverlay();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsPill("manual", "Manual Pin Mode");
          showGpsFallback(
            "Location permission was denied. Tap anywhere on the map or drag the pin to mark your parking spot."
          );
        } else {
          setGpsPill("error", "GPS Unavailable");
          showGpsFallback(
            "Unable to acquire a GPS signal right now. You can manually tap or drag the pin on the map."
          );
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 15000,
      }
    );
  }

  function showGpsFallback(message) {
    dom["gps-fallback-message"].textContent = message;
    dom["gps-fallback-banner"].classList.remove("hidden");
  }

  function startWatchPosition() {
    if (!("geolocation" in navigator) || state.watchId !== null) return;

    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        state.userCoords = { lat: latitude, lng: longitude, accuracy };
        setGpsPill("locked", `GPS Live (±${Math.round(accuracy)}m)`);
        updateLiveTrackingOverlay();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGpsPill("manual", "GPS Denied");
        } else {
          setGpsPill("error", "GPS Weak");
        }
        updateLiveTrackingOverlay();
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 4000,
      }
    );
  }

  function stopWatchPosition() {
    if (state.watchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  function initCompassListener() {
    const handler = (event) => {
      let heading = null;
      if (typeof event.webkitCompassHeading === "number") {
        heading = event.webkitCompassHeading;
      } else if (event.absolute === true && typeof event.alpha === "number") {
        heading = (360 - event.alpha) % 360;
      }

      if (heading !== null && Number.isFinite(heading)) {
        state.hasLiveCompass = true;
        state.deviceHeading = heading;
        if (state.activeSpot && state.userCoords) {
          const bearing = GeoMath.bearingDegrees(
            state.userCoords.lat,
            state.userCoords.lng,
            state.activeSpot.lat,
            state.activeSpot.lng
          );
          updateCompassUI(bearing, GeoMath.cardinalDirection(bearing));
        }
      }
    };

    if ("ondeviceorientationabsolute" in window) {
      window.addEventListener("deviceorientationabsolute", handler, true);
    } else if ("ondeviceorientation" in window) {
      window.addEventListener("deviceorientation", handler, true);
    }
  }

  /* ========================================================================
     10. Form Selection & Photo Handling
     ======================================================================== */
  function setZoneSelection(zoneValue) {
    const buttons = dom["zone-pills"].querySelectorAll(".pill-btn");
    const isPreset = PRESET_ZONES.has(zoneValue);

    buttons.forEach((btn) => {
      const isMatch = isPreset
        ? btn.dataset.zone === zoneValue
        : btn.dataset.zone === "custom";
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-pressed", String(isMatch));
    });

    if (isPreset) {
      state.selectedZone = zoneValue;
      dom["custom-zone-wrap"].classList.add("hidden");
    } else {
      state.selectedZone = "custom";
      dom["custom-zone-wrap"].classList.remove("hidden");
      dom["custom-zone-input"].value = zoneValue === "custom" ? "" : zoneValue;
    }
  }

  function setVehicleSelection(vehicleValue) {
    state.selectedVehicle = vehicleValue;
    const buttons = dom["vehicle-pills"].querySelectorAll(".vehicle-btn");
    buttons.forEach((btn) => {
      const isMatch = btn.dataset.vehicle === vehicleValue;
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-pressed", String(isMatch));
    });
    refreshSaveMarkerIcon();
  }

  function setTimerSelection(minutes) {
    const num = Number(minutes);
    const isPreset = Number.isFinite(num) && PRESET_TIMERS.has(num);
    const buttons = dom["timer-pills"].querySelectorAll(".pill-btn");

    buttons.forEach((btn) => {
      const isMatch = isPreset
        ? Number(btn.dataset.minutes) === num
        : btn.dataset.minutes === "custom";
      btn.classList.toggle("active", isMatch);
      btn.setAttribute("aria-pressed", String(isMatch));
    });

    if (isPreset) {
      state.selectedTimerMinutes = num;
      dom["custom-timer-wrap"].classList.add("hidden");
    } else {
      state.selectedTimerMinutes = "custom";
      dom["custom-timer-wrap"].classList.remove("hidden");
      if (Number.isFinite(num) && num > 0) {
        dom["custom-timer-input"].value = String(num);
      }
    }
  }

  function setFormPhoto(dataUrl, metaText = "") {
    state.pendingPhotoDataUrl = dataUrl;
    if (dataUrl) {
      dom["photo-preview-img"].src = dataUrl;
      dom["photo-preview-wrap"].classList.remove("hidden");
      dom["remove-photo-btn"].classList.remove("hidden");
      dom["photo-meta"].textContent = metaText;
    } else {
      dom["photo-preview-img"].src = "";
      dom["photo-preview-wrap"].classList.add("hidden");
      dom["remove-photo-btn"].classList.add("hidden");
      dom["photo-meta"].textContent = "";
      dom["photo-input"].value = "";
    }
  }

  async function handlePhotoUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    dom["photo-meta"].textContent = "Compressing photo…";
    try {
      const result = await ImageCompressor.compress(file);
      setFormPhoto(
        result.dataUrl,
        `Compressed: ${GeoMath.formatBytes(result.originalBytes)} → ${GeoMath.formatBytes(result.compressedBytes)}`
      );
      showToast("Photo attached and compressed.");
    } catch (err) {
      dom["photo-meta"].textContent = "";
      showToast(err.message || "Failed to process image.");
    }
  }

  function resetFormToDefaults() {
    state.isUpdating = false;
    state.pinManuallyMoved = false;
    dom["save-screen-heading"].textContent = "Save Parking Spot";
    dom["save-screen-subtitle"].textContent =
      "Confirm your pin on the campus map and tag details so you can walk straight back later.";
    dom["save-spot-btn-text"].textContent = "Save My Parking Spot";
    dom["cancel-update-btn"].classList.add("hidden");

    setZoneSelection("Main Gate");
    setVehicleSelection("Two-Wheeler/Bike");
    setTimerSelection(0);
    dom["floor-input"].value = "";
    dom["slot-input"].value = "";
    dom["pillar-input"].value = "";
    dom["notes-input"].value = "";
    dom["custom-timer-input"].value = "";
    setFormPhoto(null);

    if (state.userCoords) {
      updateSavePin(state.userCoords.lat, state.userCoords.lng, {
        manual: false,
        panMap: true,
      });
    }
  }

  function populateFormFromSpot(spot, { isUpdate = false } = {}) {
    state.isUpdating = isUpdate;
    state.pinManuallyMoved = true;

    if (isUpdate) {
      dom["save-screen-heading"].textContent = "Update Parking Spot";
      dom["save-screen-subtitle"].textContent =
        "Adjust your pin, slot tags, photo, or reminder timer.";
      dom["save-spot-btn-text"].textContent = "Update Parking Spot";
      dom["cancel-update-btn"].classList.remove("hidden");
    } else {
      dom["save-screen-heading"].textContent = "Save Parking Spot";
      dom["save-spot-btn-text"].textContent = "Save My Parking Spot";
      dom["cancel-update-btn"].classList.add("hidden");
    }

    setZoneSelection(spot.zone || "Main Gate");
    setVehicleSelection(spot.vehicleType || "Two-Wheeler/Bike");
    dom["floor-input"].value = spot.floor || "";
    dom["slot-input"].value = spot.slot || "";
    dom["pillar-input"].value = spot.pillar || "";
    dom["notes-input"].value = spot.notes || "";
    setTimerSelection(spot.reminderMinutes || 0);

    if (isUpdate && spot.photoDataUrl) {
      setFormPhoto(spot.photoDataUrl, "Saved photo attached");
    } else {
      setFormPhoto(null);
    }

    if (Number.isFinite(spot.lat) && Number.isFinite(spot.lng)) {
      updateSavePin(spot.lat, spot.lng, { manual: true, panMap: true });
    }
  }

  /* ========================================================================
     11. Active Session Lifecycle & Notifications
     ======================================================================== */
  function resolveZoneInput() {
    if (state.selectedZone !== "custom") {
      return state.selectedZone;
    }
    const custom = dom["custom-zone-input"].value.trim();
    if (!custom) {
      dom["custom-zone-input"].focus();
      showToast("Please enter a custom campus zone name.");
      return null;
    }
    return custom;
  }

  function resolveTimerMinutes() {
    if (state.selectedTimerMinutes !== "custom") {
      return Number(state.selectedTimerMinutes) || 0;
    }
    const raw = Number(dom["custom-timer-input"].value);
    if (!Number.isFinite(raw) || raw < 1 || raw > 1440) {
      dom["custom-timer-input"].focus();
      showToast("Custom timer must be between 1 and 1440 minutes.");
      return null;
    }
    return Math.round(raw);
  }

  function requestNotificationPermissionIfNeeded(minutes) {
    if (minutes <= 0 || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  }

  function sendBrowserNotification(title, body) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      new Notification(title, { body });
    } catch {
      // Ignore notification errors in restricted contexts
    }
  }

  function handleSaveFormSubmit(event) {
    event.preventDefault();

    const zone = resolveZoneInput();
    if (!zone) return;

    const reminderMinutes = resolveTimerMinutes();
    if (reminderMinutes === null) return;

    requestNotificationPermissionIfNeeded(reminderMinutes);

    const now = Date.now();
    const preservedSavedAt =
      state.isUpdating && state.activeSpot ? state.activeSpot.savedAt : now;

    const spot = {
      id:
        state.isUpdating && state.activeSpot
          ? state.activeSpot.id
          : `spot_${now}`,
      zone,
      vehicleType: state.selectedVehicle,
      floor: dom["floor-input"].value.trim(),
      slot: dom["slot-input"].value.trim(),
      pillar: dom["pillar-input"].value.trim(),
      notes: dom["notes-input"].value.trim(),
      lat: state.pinCoords.lat,
      lng: state.pinCoords.lng,
      photoDataUrl: state.pendingPhotoDataUrl || null,
      reminderMinutes,
      savedAt: preservedSavedAt,
      updatedAt: now,
      expiresAt: reminderMinutes > 0 ? now + reminderMinutes * 60_000 : null,
    };

    const saved = persistActiveSpot(spot);
    if (!saved) return;

    const wasUpdate = state.isUpdating;
    state.activeSpot = spot;
    state.isUpdating = false;
    state.warnAlertFired = false;
    state.expiredAlertFired = false;

    showActiveDashboard();
    showToast(wasUpdate ? "Parking spot updated!" : "Parking spot saved!");
  }

  function persistActiveSpot(spot) {
    const res = StorageService.setJSON(STORAGE_KEYS.ACTIVE_SPOT, spot);
    if (res.ok) return true;

    // Retry without photo if QuotaExceededError occurs
    if (spot.photoDataUrl) {
      const stripped = { ...spot, photoDataUrl: null };
      const retry = StorageService.setJSON(STORAGE_KEYS.ACTIVE_SPOT, stripped);
      if (retry.ok) {
        spot.photoDataUrl = null;
        showToast("Storage full: spot saved without photo.");
        return true;
      }
    }

    showToast("Could not save to localStorage (storage may be restricted).");
    return false;
  }

  function showSaveScreen() {
    stopTickLoop();
    stopWatchPosition();

    dom["active-dashboard-screen"].classList.add("hidden");
    dom["save-spot-screen"].classList.remove("hidden");

    window.setTimeout(() => {
      initSaveMap();
    }, 30);
  }

  function showActiveDashboard() {
    if (!state.activeSpot) {
      showSaveScreen();
      return;
    }

    const spot = state.activeSpot;
    dom["save-spot-screen"].classList.add("hidden");
    dom["active-dashboard-screen"].classList.remove("hidden");

    dom["dash-vehicle-badge"].textContent = spot.vehicleType;
    dom["dash-saved-at"].textContent = `Parked on ${GeoMath.formatTimestamp(spot.savedAt)}`;
    dom["dash-zone-pill"].textContent = spot.zone;
    dom["dash-floor"].textContent = spot.floor || "—";
    dom["dash-slot"].textContent = spot.slot || "—";
    dom["dash-pillar"].textContent = spot.pillar || "—";
    dom["dash-notes"].textContent = spot.notes || "No notes added";
    dom["dash-coords"].textContent = GeoMath.formatCoords(spot.lat, spot.lng);

    // Google Maps Walking Directions URL
    dom["google-maps-link"].href =
      `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        `${spot.lat},${spot.lng}`
      )}&travelmode=walking`;

    // Photo Preview
    if (spot.photoDataUrl) {
      dom["dash-photo-img"].src = spot.photoDataUrl;
      dom["modal-photo-img"].src = spot.photoDataUrl;
      dom["dash-photo-section"].classList.remove("hidden");
    } else {
      dom["dash-photo-img"].src = "";
      dom["dash-photo-section"].classList.add("hidden");
    }

    updateDashboardTimers();
    startTickLoop();
    startWatchPosition();

    window.setTimeout(() => {
      initLiveMap();
    }, 30);
  }

  function startTickLoop() {
    stopTickLoop();
    state.tickIntervalId = window.setInterval(updateDashboardTimers, 1000);
  }

  function stopTickLoop() {
    if (state.tickIntervalId !== null) {
      window.clearInterval(state.tickIntervalId);
      state.tickIntervalId = null;
    }
  }

  function updateDashboardTimers() {
    if (!state.activeSpot) return;
    const spot = state.activeSpot;
    const now = Date.now();

    dom["elapsed-timer-value"].textContent = GeoMath.formatDuration(now - spot.savedAt);

    const card = dom["countdown-card"];
    const alertBanner = dom["reminder-alert-banner"];
    card.classList.remove("stat-card--warn", "stat-card--expired");
    alertBanner.classList.remove("alert-banner--warning", "alert-banner--danger");

    if (!spot.expiresAt) {
      dom["countdown-value"].textContent = "No timer";
      dom["countdown-sub"].textContent = "Optional alert";
      alertBanner.classList.add("hidden");
      return;
    }

    const remaining = spot.expiresAt - now;

    if (remaining <= 0) {
      const overdue = Math.abs(remaining);
      dom["countdown-value"].textContent = `+${GeoMath.formatDuration(overdue)}`;
      dom["countdown-sub"].textContent = "Time exceeded!";
      card.classList.add("stat-card--expired");

      alertBanner.classList.remove("hidden");
      alertBanner.classList.add("alert-banner--danger");
      dom["reminder-alert-text"].textContent =
        `Parking reminder expired ${GeoMath.formatDuration(overdue)} ago (${spot.zone}).`;

      if (!state.expiredAlertFired) {
        state.expiredAlertFired = true;
        sendBrowserNotification(
          "Parking Timer Expired!",
          `Your reminder for ${spot.zone} has expired.`
        );
        if ("vibrate" in navigator) {
          try {
            navigator.vibrate([200, 100, 200]);
          } catch {
            // Ignore vibration failure
          }
        }
      }
    } else if (remaining <= 5 * 60_000) {
      dom["countdown-value"].textContent = GeoMath.formatDuration(remaining);
      dom["countdown-sub"].textContent = "Expiring soon";
      card.classList.add("stat-card--warn");

      alertBanner.classList.remove("hidden");
      alertBanner.classList.add("alert-banner--warning");
      dom["reminder-alert-text"].textContent =
        `Reminder: Less than 5 minutes left for your spot at ${spot.zone}.`;

      if (!state.warnAlertFired) {
        state.warnAlertFired = true;
        sendBrowserNotification(
          "Parking Reminder Soon",
          `Under 5 minutes remaining for ${spot.zone}.`
        );
      }
    } else {
      dom["countdown-value"].textContent = GeoMath.formatDuration(remaining);
      dom["countdown-sub"].textContent = `Alert at ${GeoMath.formatTimestamp(spot.expiresAt)}`;
      alertBanner.classList.add("hidden");
    }
  }

  function handleEndSession() {
    if (!state.activeSpot) return;

    const now = Date.now();
    const endedSpot = {
      id: state.activeSpot.id,
      zone: state.activeSpot.zone,
      vehicleType: state.activeSpot.vehicleType,
      floor: state.activeSpot.floor,
      slot: state.activeSpot.slot,
      pillar: state.activeSpot.pillar,
      notes: state.activeSpot.notes,
      lat: state.activeSpot.lat,
      lng: state.activeSpot.lng,
      savedAt: state.activeSpot.savedAt,
      endedAt: now,
      durationMs: Math.max(0, now - state.activeSpot.savedAt),
    };

    state.history = [endedSpot, ...state.history].slice(0, MAX_HISTORY_ITEMS);
    StorageService.setJSON(STORAGE_KEYS.HISTORY, state.history);

    StorageService.remove(STORAGE_KEYS.ACTIVE_SPOT);
    state.activeSpot = null;
    state.warnAlertFired = false;
    state.expiredAlertFired = false;

    resetFormToDefaults();
    renderHistory();
    showSaveScreen();
    showToast("Session archived to Parking History.");
  }

  /* ========================================================================
     12. Parking History Log
     ======================================================================== */
  function loadHistory() {
    const stored = StorageService.getJSON(STORAGE_KEYS.HISTORY, []);
    state.history = Array.isArray(stored) ? stored : [];
  }

  function renderHistory() {
    const list = dom["history-list"];
    const count = state.history.length;
    dom["history-count-badge"].textContent = String(count);

    list.innerHTML = "";
    if (count === 0) {
      dom["history-empty-state"].classList.remove("hidden");
      dom["clear-history-btn"].classList.add("hidden");
      return;
    }

    dom["history-empty-state"].classList.add("hidden");
    dom["clear-history-btn"].classList.remove("hidden");

    const fragment = document.createDocumentFragment();
    state.history.forEach((item) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const slotParts = [
        item.floor ? `Floor ${item.floor}` : "",
        item.slot ? `Slot ${item.slot}` : "",
        item.pillar ? `Pillar ${item.pillar}` : "",
      ]
        .filter(Boolean)
        .join(" • ");

      const mainDiv = document.createElement("div");
      mainDiv.className = "history-item-main";

      const titleDiv = document.createElement("div");
      titleDiv.className = "history-item-title";
      titleDiv.innerHTML = `<span>${escapeHtml(item.zone)}</span> <span class="status-badge status-badge--neutral">${escapeHtml(item.vehicleType)}</span>`;

      const metaDiv = document.createElement("div");
      metaDiv.className = "history-meta";
      metaDiv.textContent = `${GeoMath.formatTimestamp(item.savedAt)} • Duration ${GeoMath.formatDuration(
        item.durationMs || 0
      )}${slotParts ? ` • ${slotParts}` : ""}`;

      mainDiv.appendChild(titleDiv);
      mainDiv.appendChild(metaDiv);

      if (item.notes) {
        const notesP = document.createElement("p");
        notesP.className = "history-notes";
        notesP.textContent = item.notes;
        mainDiv.appendChild(notesP);
      }

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "history-item-actions";

      const reuseBtn = document.createElement("button");
      reuseBtn.type = "button";
      reuseBtn.className = "btn btn-sm btn-secondary";
      reuseBtn.textContent = "Reuse Spot";
      reuseBtn.addEventListener("click", () => reuseHistorySpot(item));

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "btn btn-sm btn-ghost-danger";
      deleteBtn.textContent = "Remove";
      deleteBtn.addEventListener("click", () => removeHistoryItem(item.id));

      actionsDiv.appendChild(reuseBtn);
      actionsDiv.appendChild(deleteBtn);

      li.appendChild(mainDiv);
      li.appendChild(actionsDiv);
      fragment.appendChild(li);
    });

    list.appendChild(fragment);
  }

  function reuseHistorySpot(item) {
    if (state.activeSpot) {
      showToast("End your active session before reusing a past spot.");
      return;
    }

    populateFormFromSpot(item, { isUpdate: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
    showToast(`Loaded "${item.zone}" details into form.`);
  }

  function removeHistoryItem(id) {
    state.history = state.history.filter((entry) => entry.id !== id);
    StorageService.setJSON(STORAGE_KEYS.HISTORY, state.history);
    renderHistory();
    showToast("Removed entry from history.");
  }

  function handleClearHistoryClick() {
    if (!state.clearHistoryArmed) {
      state.clearHistoryArmed = true;
      dom["clear-history-btn"].textContent = "Confirm Clear All?";
      state.clearHistoryTimeoutId = window.setTimeout(() => {
        state.clearHistoryArmed = false;
        dom["clear-history-btn"].textContent = "Clear History";
      }, 4000);
      return;
    }

    if (state.clearHistoryTimeoutId) {
      window.clearTimeout(state.clearHistoryTimeoutId);
    }
    state.clearHistoryArmed = false;
    dom["clear-history-btn"].textContent = "Clear History";
    state.history = [];
    StorageService.setJSON(STORAGE_KEYS.HISTORY, []);
    renderHistory();
    showToast("Parking history cleared.");
  }

  /* ========================================================================
     13. Lightbox Modal & Utilities
     ======================================================================== */
  function openPhotoModal() {
    if (!dom["modal-photo-img"].src) return;
    dom["photo-modal"].classList.remove("hidden");
    dom["close-photo-modal"].focus();
  }

  function closePhotoModal() {
    dom["photo-modal"].classList.add("hidden");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ========================================================================
     14. Event Binding & Initialization
     ======================================================================== */
  function bindEvents() {
    dom["theme-toggle"].addEventListener("click", () => {
      applyTheme(state.theme === "dark" ? "light" : "dark");
    });

    dom["recenter-gps-btn"].addEventListener("click", () => {
      state.pinManuallyMoved = false;
      requestInitialGps({ recenterPin: true });
    });

    dom["zone-pills"].addEventListener("click", (e) => {
      const btn = e.target.closest(".pill-btn");
      if (!btn) return;
      setZoneSelection(btn.dataset.zone);
      if (btn.dataset.zone === "custom") {
        dom["custom-zone-input"].focus();
      }
    });

    dom["vehicle-pills"].addEventListener("click", (e) => {
      const btn = e.target.closest(".vehicle-btn");
      if (!btn) return;
      setVehicleSelection(btn.dataset.vehicle);
    });

    dom["timer-pills"].addEventListener("click", (e) => {
      const btn = e.target.closest(".pill-btn");
      if (!btn) return;
      setTimerSelection(btn.dataset.minutes);
      if (btn.dataset.minutes === "custom") {
        dom["custom-timer-input"].focus();
      }
    });

    dom["photo-input"].addEventListener("change", handlePhotoUpload);
    dom["remove-photo-btn"].addEventListener("click", () => setFormPhoto(null));

    dom["parking-form"].addEventListener("submit", handleSaveFormSubmit);

    dom["cancel-update-btn"].addEventListener("click", () => {
      state.isUpdating = false;
      showActiveDashboard();
    });

    dom["update-spot-btn"].addEventListener("click", () => {
      if (!state.activeSpot) return;
      populateFormFromSpot(state.activeSpot, { isUpdate: true });
      showSaveScreen();
    });

    dom["end-session-btn"].addEventListener("click", handleEndSession);
    dom["fit-route-btn"].addEventListener("click", fitLiveMapBounds);

    dom["dash-photo-trigger"].addEventListener("click", openPhotoModal);
    dom["close-photo-modal"].addEventListener("click", closePhotoModal);
    dom["photo-modal-backdrop"].addEventListener("click", closePhotoModal);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !dom["photo-modal"].classList.contains("hidden")) {
        closePhotoModal();
      }
    });

    dom["clear-history-btn"].addEventListener("click", handleClearHistoryClick);
  }

  function bootstrap() {
    cacheDom();
    initTheme();
    bindEvents();
    initCompassListener();
    loadHistory();
    renderHistory();

    if (!StorageService.isAvailable()) {
      showToast("Browser storage is disabled; spots won't persist after refresh.");
    }

    const savedSpot = StorageService.getJSON(STORAGE_KEYS.ACTIVE_SPOT, null);
    if (savedSpot && Number.isFinite(savedSpot.lat) && Number.isFinite(savedSpot.lng)) {
      state.activeSpot = savedSpot;
      showActiveDashboard();
      requestInitialGps({ recenterPin: false });
    } else {
      showSaveScreen();
      requestInitialGps({ recenterPin: true });
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
