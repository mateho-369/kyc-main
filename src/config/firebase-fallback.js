// Fail-closed fallback used only when the real Firebase Web App config is missing
// or invalid. It must never fabricate an authenticated user.
const firebaseUnavailable = () => Promise.reject(new Error('Firebase is not configured. Add the shared Firebase project Web App values to the local environment.'));
const mockAuth = {
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

const mockDb = {
  collection: () => ({
    doc: () => ({
      get: async () => ({ exists: false, data: () => ({}) }),
      set: async () => {},
      update: async () => {},
      delete: async () => {}
    })
  })
};

export { mockAuth as auth, mockDb as db };