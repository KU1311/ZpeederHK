async function requestPermissions() {
  try {
    const permission = await navigator.permissions.query({ name: 'geolocation' });
    if (permission.state === 'granted') {
      return true;
    } else if (permission.state === 'prompt') {
      return new Promise(resolve => {
        navigator.geolocation.getCurrentPosition(
          () => resolve(true),
          () => {
            alert('Location permission is required to use this app.');
            resolve(false);
          }
        );
      });
    } else {
      alert('Location permission is required to use this app.');
      return false;
    }
  } catch (err) {
    console.error('Permission error:', err);
    return false;
  }
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.register('sw.js');
      console.log('Service Worker registered:', registration);
    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  }
}

async function loadSpeedCameras(retries = 3, delay = 1000) {
  if (typeof Papa === 'undefined') {
    console.error('PapaParse is not loaded. Please ensure the PapaParse script is included.');
    return [];
  }
  const csvUrl = 'https://raw.githubusercontent.com/KU1311/ZpeederHK/main/cam2025_all_test1.csv';
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(csvUrl)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
          return response.text();
        })
        .then(csvText => {
          const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: true });
          if (parsed.errors.length > 0) {
            console.error('CSV parsing errors:', parsed.errors);
            throw new Error('Failed to parse CSV');
          }
          const cameras = parsed.data.map((row, index) => {
            if (!row.ID || isNaN(row.lat) || isNaN(row.long) || isNaN(row.bearing) || isNaN(row.SPEED)) {
              console.warn(`Skipping invalid row ${index + 1}:`, row);
              return null;
            }
            return {
              id: row.ID,
              y: parseFloat(row.lat),
              x: parseFloat(row.long),
              roadDirection: parseFloat(row.bearing),
              remarks: row.SITE_DES_1 || 'No description',
              speedLimit: parseFloat(row.SPEED)
            };
          }).filter(row => row !== null);
          if (cameras.length === 0) {
            console.error('No valid camera data after parsing. Check CSV content.');
            throw new Error('No valid camera data');
          }
          console.log(`Loaded ${cameras.length} cameras successfully`);
          return cameras;
        });
      return response;
    } catch (err) {
      console.error(`Attempt ${attempt} failed:`, err.message);
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      return [];
    }
  }
  return [];
}

async function startLocationMonitoring() {
  const hasPermission = await requestPermissions();
  if (!hasPermission) {
    document.getElementById('status').textContent = 'Location permission denied.';
    return;
  }

  if ('Notification' in window && Notification.permission !== 'granted') {
    await Notification.requestPermission();
  }

  await registerServiceWorker();

  // Initialize map with default coordinates (fallback)
  const defaultCoords = [22.305451, 114.169656];
  const defaultZoom = 15; // ~500m view
  const map = L.map('map').setView(defaultCoords, defaultZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    opacity: 0.7
  }).addTo(map);

  // Load speed camera data
  const speedCameras = await loadSpeedCameras();
  if (speedCameras.length === 0) {
    document.getElementById('status').textContent = 'Error loading speed camera data. Check console for details.';
    return;
  }

  // Add camera markers
  speedCameras.forEach(camera => {
    L.marker([camera.y, camera.x])
      .addTo(map)
      .bindPopup(`Camera ${camera.id}: ${camera.remarks}<br>Speed Limit: ${camera.speedLimit} km/h`);
  });

  // User location marker - using a standard Leaflet marker with custom icon
  let userMarker = null;
  const userIcon = L.divIcon({
    className: 'current-location-marker',
    html: '<div style="width: 20px; height: 20px; background: blue; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  // Update UI with location and speed
  navigator.geolocation.watchPosition(
    position => {
      const { latitude, longitude, heading, speed } = position.coords;
      const speedKmh = speed ? (speed * 3.6).toFixed(1) : 'N/A'; // Convert m/s to km/h
      document.getElementById('status').textContent = 
        `Lat: ${latitude.toFixed(4)}, Lon: ${longitude.toFixed(4)}, Heading: ${heading ? heading.toFixed(0) : 'N/A'}°, Speed: ${speedKmh} km/h`;

      // Find nearest upcoming camera
      let nearestCamera = null;
      let minDistance = Infinity;
      speedCameras.forEach(camera => {
        const dist = getDistance(
          { latitude, longitude },
          { latitude: camera.y, longitude: camera.x }
        );
        const bearingToCamera = getRhumbLineBearing(
          { latitude, longitude },
          { latitude: camera.y, longitude: camera.x }
        );
        const headingDifference = Math.abs(
          ((bearingToCamera - heading + 360) % 360) - ((camera.roadDirection - heading + 360) % 360)
        );
        if (dist <= 200 && headingDifference <= 45 && dist < minDistance) {
          minDistance = dist;
          nearestCamera = camera;
        }
      });

      if (nearestCamera) {
        document.getElementById('alert-text').textContent = `Nearest camera ahead in ${Math.round(minDistance)} meters! Limit: ${nearestCamera.speedLimit} km/h. ${nearestCamera.remarks}`;
      } else {
        document.getElementById('alert-text').textContent = 'No camera alert';
      }

      // Update user marker
      const userCoords = [latitude, longitude];
      
      if (userMarker) {
        userMarker.setLatLng(userCoords);
        // Remove rotation for simplicity - the custom CSS approach wasn't working
      } else {
        userMarker = L.marker(userCoords, {
          icon: userIcon,
          zIndexOffset: 1000 // Make sure user marker appears on top
        }).addTo(map).bindPopup(`<div class="current-location-label">Your Location</div>`);
      }
      
      // Center map on user location
      map.setView(userCoords, 15);
    },
    error => {
      document.getElementById('status').textContent = 'Error fetching location: ' + error.message;
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
  );

  // Send speed camera data to Service Worker
  navigator.serviceWorker.ready.then(registration => {
    registration.active.postMessage({ type: 'SET_CAMERAS', cameras: speedCameras });
  });
}


startLocationMonitoring();
