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
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Simplified fetch without custom headers to avoid preflight
      const response = await fetch('https://raw.githubusercontent.com/KU1311/ZpeederHK/main/cam2025_all_test1.csv', {
        method: 'GET',
        cache: 'no-cache'
      });
      if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
      const csvText = await response.text();
      const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true, dynamicTyping: true });
      if (parsed.errors.length > 0) {
        console.error('CSV parsing errors:', parsed.errors);
        throw new Error('Failed to parse CSV');
      }
      const cameras = parsed.data.map((row, index) => {
        if (!row.ID || isNaN(row.lat) || isNaN(row.long) || isNaN(row.bearing)) {
          console.warn(`Skipping invalid row ${index + 1}:`, row);
          return null;
        }
        return {
          id: row.ID,
          y: parseFloat(row.lat),
          x: parseFloat(row.long),
          roadDirection: parseFloat(row.bearing),
          remarks: row.SITE_DES_1 || 'No description'
        };
      }).filter(row => row !== null);
      if (cameras.length === 0) {
        console.error('No valid camera data after parsing. Check CSV content.');
        throw new Error('No valid camera data');
      }
      console.log(`Loaded ${cameras.length} cameras successfully`);
      return cameras;
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

  // Load speed camera data
  const speedCameras = await loadSpeedCameras();
  if (speedCameras.length === 0) {
    document.getElementById('status').textContent = 'Error loading speed camera data. Check console for details.';
    return;
  }

  // Update UI with location
  navigator.geolocation.watchPosition(
    position => {
      const { latitude, longitude, heading } = position.coords;
      document.getElementById('status').textContent = 
        `Lat: ${latitude.toFixed(4)}, Lon: ${longitude.toFixed(4)}, Heading: ${heading ? heading.toFixed(0) : 'N/A'}°`;
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
