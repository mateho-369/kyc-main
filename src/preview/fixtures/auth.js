import { currentUser } from './store';
export const getUserRole = async () => currentUser().role;
export const checkAuth = async () => currentUser();
