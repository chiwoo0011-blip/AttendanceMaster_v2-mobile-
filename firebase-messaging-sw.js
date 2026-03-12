// Firebase Cloud Messaging Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

// Firebase configuration - FCM requires apiKey, projectId, messagingSenderId, appId
// TODO: Firebase Console > Project Settings > General > Your apps 에서 값을 복사하세요
const firebaseConfig = {
    apiKey: "AIzaSyCOQ0VF_4piElLF_oHOi7IFmNaOCI_25iA",
    authDomain: "yrs-workingdaycheck.firebaseapp.com",
    databaseURL: "https://yrs-workingdaycheck-default-rtdb.firebaseio.com/",
    projectId: "yrs-workingdaycheck",
    storageBucket: "yrs-workingdaycheck.appspot.com",
    messagingSenderId: "20187121102",
    appId: "1:20187121102:web:6cee6c6145e232bf1a579f"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
    console.log('Received background message:', payload);

    const notificationTitle = payload.notification.title || '새 알림';
    const notificationOptions = {
        body: payload.notification.body || '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        data: payload.data,
        actions: [
            {
                action: 'open',
                title: '확인'
            }
        ]
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    if (event.action === 'open' || !event.action) {
        event.waitUntil(
            clients.openWindow('/worker.html')
        );
    }
});
