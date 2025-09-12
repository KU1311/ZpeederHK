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

async function loadSpeedCamerasAndLines(retries = 3, delay = 1000) {
  if (typeof Papa === 'undefined') {
    console.error('PapaParse is not loaded. Please ensure the PapaParse script is included.');
    return { cameras: [], lines: [] };
  }
  
  const csvUrl = 'https://raw.githubusercontent.com/KU1311/ZpeederHK/main/cam2025_all_test1.csv';
  const geojsonUrl = 'https://raw.githubusercontent.com/KU1311/ZpeederHK/main/fake_temp_cam_line.geojson';
  
  try {
    // Load camera points
    const cameras = await loadSpeedCameras(retries, delay);
    
    // Load camera lines
    const linesResponse = await fetch(geojsonUrl);
    if (!linesResponse.ok) throw new Error(`HTTP error! Status: ${linesResponse.status}`);
    const linesData = await linesResponse.json();
    
    const lines = linesData.features.map(feature => {
      const props = feature.properties;
      const coords = feature.geometry.coordinates[0]; // Get first line segment
      return {
        id: props.ID,
        remarks: props.SITE_DES_1 || props.SITE_DESC_ || 'No description',
        speedLimit: parseInt(props.SPEED) || 50,
        roadDirection: parseInt(props.bearing) || 0,
        line: coords.map(coord => ({ longitude: coord[0], latitude: coord[1] }))
      };
    });
    
    console.log(`Loaded ${cameras.length} cameras and ${lines.length} lines successfully`);
    return { cameras, lines };
    
  } catch (err) {
    console.error('Error loading camera lines:', err);
    return { cameras: [], lines: [] };
  }
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

  // Load speed camera data and lines
  const { cameras: speedCameras, lines: cameraLines } = await loadSpeedCamerasAndLines();
  if (speedCameras.length === 0 || cameraLines.length === 0) {
    document.getElementById('status').textContent = 'Error loading speed camera data. Check console for details.';
    return;
  }

  // Add camera point markers
  speedCameras.forEach(camera => {
    L.marker([camera.y, camera.x])
      .addTo(map)
      .bindPopup(`Camera ${camera.id}: ${camera.remarks}<br>Speed Limit: ${camera.speedLimit} km/h`);
  });

  // Add camera lines to map
  cameraLines.forEach(line => {
    const latLngs = line.line.map(coord => [coord.latitude, coord.longitude]);
    L.polyline(latLngs, {
      color: 'red',
      weight: 3,
      opacity: 0.7,
      dashArray: '5, 10'
    }).addTo(map).bindPopup(`Line: ${line.id} - ${line.remarks}<br>Speed Limit: ${line.speedLimit} km/h`);
  });

  // User location marker
  let userMarker = null;

  // Create a simple blue circle without the inner triangle
  const createUserIcon = (heading) => {
    return L.divIcon({
      className: 'current-location-marker',
      html: `
        <div style="
          width: 20px;
          height: 20px;
          background: blue;
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 0 10px rgba(0,0,0,0.5);
          transform: rotate(${heading}deg);
        "></div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  };

  // Track last notification time to avoid spamming
  let lastNotificationTime = 0;
  const NOTIFICATION_COOLDOWN = 30000; // 30 seconds
  const alertedLines = new Set(); // Track which lines have triggered alerts

  // Function to check if user crosses a line
  function isCrossingLine(userPos, line, userHeading, tolerance = 45) {
    // Check if user is near the line (within 50 meters of any point)
    const nearLine = line.some(point => 
      geolib.getDistance(userPos, point) <= 50
    );
    
    if (!nearLine) return false;
    
    // Check bearing alignment (± tolerance degrees)
    if (userHeading) {
      const bearingDiff = Math.abs(
        ((line.roadDirection - userHeading + 360) % 360) - 180
      );
      return bearingDiff <= tolerance;
    }
    
    return true; // If no heading, assume crossing
  }

  // Function to show phone notification
  function showPhoneNotification(line, distance) {
    const now = Date.now();
    if (now - lastNotificationTime < NOTIFICATION_COOLDOWN || alertedLines.has(line.id)) {
      return; // Skip if within cooldown or already alerted
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification('🚨 Speed Camera Alert', {
        body: `Approaching camera line! Limit: ${line.speedLimit} km/h. ${line.remarks}`,
        icon: 'https://raw.githubusercontent.com/KU1311/ZpeederHK/main/icon.png',
        tag: 'speed-camera-alert',
        requireInteraction: true,
        vibrate: [200, 100, 200]
      });

      notification.onclick = function() {
        window.focus();
        notification.close();
      };

      lastNotificationTime = now;
      alertedLines.add(line.id);
      
      // Clear the alert after cooldown
      setTimeout(() => alertedLines.delete(line.id), NOTIFICATION_COOLDOWN);
    }
  }

  // Update UI with location and speed
  navigator.geolocation.watchPosition(
    position => {
      const { latitude, longitude, heading, speed } = position.coords;
      const speedKmh = speed ? (speed * 3.6).toFixed(1) : 'N/A';
      document.getElementById('status').textContent = 
        `Lat: ${latitude.toFixed(4)}, Lon: ${longitude.toFixed(4)}, Heading: ${heading ? heading.toFixed(0) : 'N/A'}°, Speed: ${speedKmh} km/h`;

      const userPos = { latitude, longitude };
      let alertLine = null;
      
      // Check if user is crossing any camera line
      cameraLines.forEach(line => {
        if (isCrossingLine(userPos, line.line, heading)) {
          alertLine = line;
        }
      });

      // Display alert for line crossing
      if (alertLine) {
        const alertText = `ALERT: Approaching camera line! Limit: ${alertLine.speedLimit} km/h. ${alertLine.remarks}`;
        document.getElementById('alert-text').textContent = alertText;
        
        // Show phone notification
        showPhoneNotification(alertLine);
      } else {
        document.getElementById('alert-text').textContent = 'No camera alert';
        // Reset alerted lines when not near any line
        if (Array.from(alertedLines).some(lineId => 
          !cameraLines.some(line => line.id === lineId && isCrossingLine(userPos, line.line, heading))
        )) {
          alertedLines.clear();
        }
      }

      // Find nearest camera regardless of direction (for error checking)
      let nearestCamera = null;
      let minDistance = Infinity;
      
      speedCameras.forEach(camera => {
        const dist = geolib.getDistance(userPos, { latitude: camera.y, longitude: camera.x });
        if (dist < minDistance) {
          minDistance = dist;
          nearestCamera = camera;
        }
      });
      
      // Display nearest camera info for debugging
      if (nearestCamera) {
        console.log(`Nearest camera: ${Math.round(minDistance)}m - ${nearestCamera.remarks} (Limit: ${nearestCamera.speedLimit} km/h)`);
      }

      // Update user marker
      const userCoords = [latitude, longitude];
      const currentHeading = heading || 0;
      
      if (userMarker) {
        userMarker.setLatLng(userCoords);
        userMarker.setIcon(createUserIcon(currentHeading));
      } else {
        userMarker = L.marker(userCoords, {
          icon: createUserIcon(currentHeading),
          zIndexOffset: 1000
        }).addTo(map).bindPopup(`<div class="current-location-label">Your Location</div>`);
        map.setView(userCoords, 16);
      }
    },
    error => {
      document.getElementById('status').textContent = 'Error fetching location: ' + error.message;
    },
    { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
  );

  // Send speed camera data to Service Worker
  navigator.serviceWorker.ready.then(registration => {
    registration.active.postMessage({ type: 'SET_CAMERAS', cameras: speedCameras });
  });
}


startLocationMonitoring();
