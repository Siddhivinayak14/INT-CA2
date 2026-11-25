# Where Did I Park? (Campus Parking)

A responsive, mobile-first web application for saving and locating parked vehicles across a university or college campus. Built with semantic HTML5, modern CSS3, vanilla ES6+ JavaScript, **Leaflet.js** + **OpenStreetMap** tiles (no API key required), the **Browser Geolocation API**, HTML5 Canvas image compression, and resilient `localStorage` persistence.

## Features

- **Top Header Telemetry & Theme Toggle**
  - Live GPS status pill (`Locating GPS…`, `GPS Locked (±Xm)`, `Manual Pin Mode`, `GPS Unavailable`).
  - Light / Dark mode toggle with automatic system preference detection and `localStorage` persistence (including dark-mode styling for OpenStreetMap tiles).

- **Save Parking Spot Screen**
  - Interactive Leaflet.js map with a draggable vehicle pin and tap-to-drop manual fallback if GPS is denied or unavailable.
  - Quick-select campus zone pills (`Main Gate`, `Academic Block 34`, `Central Library`, `Hostel Zone`, `Sports Complex`, or `+ Custom`).
  - Vehicle type selector (`Two-Wheeler/Bike`, `Car`, `EV/Bicycle`).
  - Floor / Level, Slot Number, Pillar / Row, and Landmark Notes fields.
  - Optional photo capture/upload compressed client-side via HTML5 `<canvas>` (max 900px, JPEG) to fit safely in `localStorage`.
  - Optional parking reminder timer (`None`, `30 min`, `1 hr`, `2 hrs`, `4 hrs`, or custom minutes).

- **Active Parking Dashboard**
  - Saved zone, vehicle badge, slot details, landmark notes, and tap-to-enlarge photo lightbox.
  - Live-ticking elapsed time counter (`HH:MM:SS`) and reminder countdown alerts (5-minute warning + expired overdue alert + optional browser notification).
  - Dual-pin live tracking map (`navigator.geolocation.watchPosition`) showing your live position, accuracy radius, parked vehicle pin, and a dashed path polyline between you and your vehicle.
  - Real-time Haversine distance, estimated walking time, and directional compass arrow (uses device compass heading when available, with North-up bearing fallback).
  - **Open in Google Maps** walking directions button.
  - **Update Spot** flow to edit coordinates, slot details, photo, or timer without ending the session.
  - **I Found My Vehicle (End Session)** button to archive the session into Parking History.

- **Collapsible Parking History Log**
  - Stores completed sessions locally (up to 30 recent entries).
  - One-tap **Reuse Spot** to pre-fill frequent campus parking locations, individual entry removal, and two-step **Clear History** confirmation.

## Project Structure

```text
.
├── index.html   # Semantic HTML5 layout, screens, modal, and Leaflet CDN links
├── styles.css   # Mobile-first CSS3, light/dark CSS variables, responsive grids
├── app.js       # ES6+ modular logic (StorageService, GeoMath, ImageCompressor, Maps, UI)
└── README.md    # Documentation
```

## Getting Started

No build step or API keys are required.

1. **Run with a local HTTP server (recommended for Geolocation & Camera APIs):**
   ```bash
   # Using Python 3
   python -m http.server 8080
   ```
   Then open `http://localhost:8080` in your browser.

   *(Or open `index.html` directly in a browser, though some browsers restrict Geolocation on `file://` URLs.)*

2. **Mobile Testing:**
   Browser Geolocation and Device Orientation APIs require a **secure context (`https://` or `localhost`)** on most mobile browsers.

## Browser Permissions & Fallbacks

- **Location Denied / Unavailable:** The app automatically switches to **Manual Pin Mode** so you can pan, zoom, tap anywhere on the campus map, or drag the vehicle marker manually.
- **Notifications:** Requested only if you configure a parking reminder timer; in-app visual alert banners always appear even if browser notifications are blocked.
- **Storage Limits:** All `localStorage` reads/writes are wrapped in error-safe handlers. If a photo exceeds storage quota, the app retries saving the parking spot without the photo and notifies you.
