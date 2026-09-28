import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { currentUser, subscribe, snapshot, setPerspective } from './store';
const Context = createContext(null);
export const useAuth = () => useContext(Context);
export function FixtureIdentityProvider({ children }) {
  useSyncExternalStore(subscribe,snapshot,snapshot);
  // This context exists only in the special preview compilation. It does not
  // create a session, token, DB user, or Firebase account.
  return <Context.Provider value={{user:currentUser(),isAuthenticated:true,loading:false,logout:async()=>setPerspective('user')}}>{children}</Context.Provider>;
}
