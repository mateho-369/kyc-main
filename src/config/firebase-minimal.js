import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Sharegram と共有する Firebase プロジェクト（adroit-standard-496710-r5）
const firebaseConfig = {
  apiKey: "AIzaSyC9pSqeZeOjvndPX_dPEsaIU22CUWVYB_0",
  authDomain: "adroit-standard-496710-r5.firebaseapp.com",
  projectId: "adroit-standard-496710-r5",
  storageBucket: "adroit-standard-496710-r5.firebasestorage.app",
  messagingSenderId: "716516303448",
  appId: "1:716516303448:web:e7ab0a08b087ffd60f602d"
};

let app;
let auth;

try {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  console.log('Firebase initialized successfully');
} catch (error) {
  console.log('Firebase initialization failed:', error);
  // Continue without Firebase
}

export { app, auth };
export default app;
