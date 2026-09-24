// Firebase fallback configuration for when Firebase is not properly initialized
const mockAuth = {
  currentUser: null,
  signOut: async () => {
    console.log('🔄 Mock Firebase signOut called - Firebase initialization fallback');
    return Promise.resolve();
  },
  signInWithEmailAndPassword: async (email, password) => {
    console.log('🔄 Mock Firebase signIn called - Firebase initialization fallback');
    return Promise.resolve({ 
      user: { 
        email, 
        uid: 'mock-user-id',
        displayName: 'Mock User' 
      } 
    });
  },
  onAuthStateChanged: (callback) => {
    console.log('🔄 Mock Firebase onAuthStateChanged - Firebase initialization fallback');
    // Return unsubscribe function
    return () => {};
  },
  useDeviceLanguage: () => {
    console.log('🔄 Mock Firebase useDeviceLanguage - Firebase initialization fallback');
  }
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