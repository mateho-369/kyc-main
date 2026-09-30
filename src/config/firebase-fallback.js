// Fail-closed fallback used only when the real Firebase Web App config is missing
// or invalid. It must never fabricate an authenticated user.
const firebaseUnavailable = () => Promise.reject(new Error('Firebase is not configured. Add the shared Firebase project Web App values to the local environment.'));
const unavailableAuth = {
  currentUser: null,
  signOut: async () => Promise.resolve(),
  signInWithEmailAndPassword: firebaseUnavailable,
  signInWithPopup: firebaseUnavailable,
  onAuthStateChanged: (callback) => {
    if (typeof callback === 'function') callback(null);
    return () => {};
  },
  useDeviceLanguage: () => {}
};

const unavailableDb = {
  collection: () => ({
    doc: () => ({
      get: firebaseUnavailable,
      set: firebaseUnavailable,
      update: firebaseUnavailable,
      delete: firebaseUnavailable
    })
  })
};

export { unavailableAuth as auth, unavailableDb as db };