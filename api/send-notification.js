const admin = require('firebase-admin');

// Firebase Admin 초기화 (Vercel serverless 환경에서 재사용)
if (!admin.apps.length) {
    const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL } = process.env;

    if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY || !FIREBASE_DATABASE_URL) {
        console.error('Firebase 환경변수가 설정되지 않았습니다. Vercel 환경변수를 확인하세요.');
    } else {
        admin.initializeApp({
            credential: admin.credential.cert({
                projectId: FIREBASE_PROJECT_ID,
                clientEmail: FIREBASE_CLIENT_EMAIL,
                privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
            }),
            databaseURL: FIREBASE_DATABASE_URL
        });
    }
}

module.exports = async (req, res) => {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!admin.apps.length) {
        return res.status(500).json({ error: 'Firebase not initialized. Check environment variables.' });
    }

    const { title, body, workerNames } = req.body;

    if (!title || !body || !Array.isArray(workerNames) || workerNames.length === 0) {
        return res.status(400).json({ error: 'Missing required fields: title, body, workerNames' });
    }

    const results = { success: [], failed: [] };

    for (const workerName of workerNames) {
        try {
            const db = admin.database();
            const snapshot = await db.ref(`/fcmTokens/${encodeURIComponent(workerName)}`).once('value');
            const token = snapshot.val();

            if (!token) {
                results.failed.push({ name: workerName, reason: 'No FCM token' });
                continue;
            }

            await admin.messaging().send({
                token: token,
                notification: { title, body },
                webpush: {
                    notification: {
                        icon: '/icon-192.png',
                        badge: '/icon-192.png',
                        vibrate: [200, 100, 200]
                    },
                    fcmOptions: {
                        link: '/worker.html'
                    }
                }
            });

            results.success.push(workerName);
        } catch (error) {
            console.error(`FCM send failed for ${workerName}:`, error.code, error.message);
            results.failed.push({ name: workerName, reason: error.message });

            // 만료/무효 토큰 자동 정리
            if (error.code === 'messaging/registration-token-not-registered' ||
                error.code === 'messaging/invalid-registration-token') {
                try {
                    await admin.database().ref(`/fcmTokens/${encodeURIComponent(workerName)}`).remove();
                } catch (e) { /* ignore */ }
            }
        }
    }

    return res.status(200).json({
        message: `Sent to ${results.success.length}/${workerNames.length}`,
        results
    });
};
