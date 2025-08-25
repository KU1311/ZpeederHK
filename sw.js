let speedCameras = [];

self.addEventListener('message', event => {
  if (event.data.type === 'SET_CAMERAS') {
    speedCameras = event.data.cameras;
  }
});

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

function checkSpeedCameras(position) {
  const { latitude, longitude, heading } = position.coords;
  if (!heading) return; // Skip if heading is unavailable

  speedCameras.forEach(camera => {
    const distance = getDistance(
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

    if (distance <= 200 && headingDifference <= 45) {
      self.registration.showNotification('Speed Camera Alert', {
        body: `Speed camera ahead in 200 meters! ${camera.remarks}`,
        icon: 'https://via.placeholder.com/192', // Replace with your icon
        vibrate: [200, 100, 200],
      });
    }
  });
}

self.addEventListener('periodicsync', event => {
  if (event.tag === 'location-sync') {
    event.waitUntil(
      new Promise(resolve => {
        navigator.geolocation.watchPosition(
          position => {
            checkSpeedCameras(position);
            resolve();
          },
          error => {
            console.error('Geolocation error in Service Worker:', error);
            resolve();
          },
          { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
        );
      })
    );
  }
});
