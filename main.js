const speedCameras = [
  { id: 1, x: 114.158, y: 22.282, roadDirection: 90 }, // Eastbound
  { id: 2, x: 114.160, y: 22.285, roadDirection: 180 }, // Southbound
  // Add more camera locations as needed
];

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

  // Initial location for UI
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
