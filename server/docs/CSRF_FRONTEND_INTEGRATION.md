# CSRF Frontend Integration Guide

## Overview
This guide explains how to integrate CSRF protection with the frontend authentication system for seamless 95% frontend integration.

## CSRF Configuration

### Backend Endpoints
- `GET /api/csrf-token` - Get current CSRF token
- `POST /api/csrf-token/refresh` - Force refresh CSRF token
- `GET /api/csrf-token/validate` - Validate current token
- `GET /api/csrf-config` - Get CSRF configuration

### Configuration Details
```javascript
{
  headerName: 'X-CSRF-Token',
  cookieName: 'csrf-token',
  protectedMethods: ['POST', 'PUT', 'DELETE', 'PATCH'],
  excludedPaths: [
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/firebase/register',
    '/api/health',
    '/health',
    '/api/csrf-token'
  ]
}
```

## Frontend Implementation

### 1. Axios Interceptor Setup

```javascript
// utils/axiosConfig.js
import axios from 'axios';

// Get CSRF token from cookie
const getCSRFToken = () => {
  const match = document.cookie.match(/csrf-token=([^;]+)/);
  return match ? match[1] : null;
};

// Create axios instance
const apiClient = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5000',
  withCredentials: true
});

// Request interceptor - automatically add CSRF token
apiClient.interceptors.request.use(
  (config) => {
    // Add CSRF token for protected methods
    const protectedMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
    if (protectedMethods.includes(config.method?.toUpperCase())) {
      const csrfToken = getCSRFToken();
      if (csrfToken) {
        config.headers['X-CSRF-Token'] = csrfToken;
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle CSRF token refresh
apiClient.interceptors.response.use(
  (response) => {
    // Check for refreshed CSRF token
    const refreshedToken = response.headers['x-csrf-token-refreshed'];
    if (refreshedToken) {
      console.log('CSRF token automatically refreshed');
    }
    return response;
  },
  async (error) => {
    if (error.response?.status === 403 && 
        error.response?.data?.error === 'CSRF_TOKEN_MISSING') {
      
      try {
        // Fetch new CSRF token
        const tokenResponse = await axios.get('/api/csrf-token', { withCredentials: true });
        const newToken = tokenResponse.data.csrfToken;
        
        // Retry original request with new token
        const originalRequest = error.config;
        originalRequest.headers['X-CSRF-Token'] = newToken;
        return apiClient(originalRequest);
        
      } catch (tokenError) {
        console.error('Failed to refresh CSRF token:', tokenError);
      }
    }
    
    return Promise.reject(error);
  }
);

export default apiClient;
```

### 2. Authentication Service Integration

```javascript
// services/authService.js
import apiClient from '../utils/axiosConfig';

class AuthService {
  async initializeCSRF() {
    try {
      const response = await apiClient.get('/api/csrf-token');
      return response.data.csrfToken;
    } catch (error) {
      console.error('Failed to initialize CSRF token:', error);
      throw error;
    }
  }

  async firebaseLogin(idToken) {
    try {
      const response = await apiClient.post('/api/auth/firebase/verify', {
        idToken
      });
      
      // CSRF token is automatically included in response
      return response.data;
    } catch (error) {
      if (error.response?.data?.error === 'CSRF_VALIDATION_FAILED') {
        // Attempt to refresh CSRF token and retry
        await this.initializeCSRF();
        return this.firebaseLogin(idToken);
      }
      throw error;
    }
  }

  async register(userData) {
    return apiClient.post('/api/auth/firebase/register', userData);
  }

  async logout() {
    return apiClient.post('/api/auth/firebase/logout');
  }

  async updateProfile(profileData) {
    return apiClient.put('/api/auth/firebase/update-profile', profileData);
  }
}

export default new AuthService();
```

### 3. React Context Integration

```javascript
// contexts/AuthContext.js
import React, { createContext, useContext, useEffect, useState } from 'react';
import authService from '../services/authService';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [csrfToken, setCsrfToken] = useState(null);

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        // Initialize CSRF token on app start
        const token = await authService.initializeCSRF();
        setCsrfToken(token);
        
        // Check existing session
        await checkSession();
      } catch (error) {
        console.error('Auth initialization failed:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const checkSession = async () => {
    try {
      const response = await authService.verifySession();
      setUser(response.data.user);
    } catch (error) {
      setUser(null);
    }
  };

  const login = async (idToken) => {
    try {
      const response = await authService.firebaseLogin(idToken);
      setUser(response.data.user);
      
      // Update CSRF token if provided
      if (response.data.csrfToken) {
        setCsrfToken(response.data.csrfToken);
      }
      
      return response;
    } catch (error) {
      throw error;
    }
  };

  const logout = async () => {
    try {
      await authService.logout();
      setUser(null);
      
      // Refresh CSRF token after logout
      const newToken = await authService.initializeCSRF();
      setCsrfToken(newToken);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const value = {
    user,
    loading,
    csrfToken,
    login,
    logout,
    checkSession
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
```

### 4. Error Handling Component

```javascript
// components/CSRFErrorHandler.js
import React from 'react';
import { useAuth } from '../contexts/AuthContext';

const CSRFErrorHandler = ({ error, onRetry }) => {
  const { initializeCSRF } = useAuth();

  const handleCSRFRetry = async () => {
    try {
      await initializeCSRF();
      if (onRetry) {
        onRetry();
      }
    } catch (refreshError) {
      console.error('Failed to refresh CSRF token:', refreshError);
    }
  };

  if (error?.response?.data?.error === 'CSRF_VALIDATION_FAILED') {
    return (
      <div className="csrf-error-container">
        <h3>Security Token Expired</h3>
        <p>Your session security token has expired. Please refresh to continue.</p>
        <button onClick={handleCSRFRetry} className="retry-button">
          Refresh Token
        </button>
      </div>
    );
  }

  return null;
};

export default CSRFErrorHandler;
```

## Testing CSRF Integration

### 1. Manual Testing
```bash
# Get CSRF token
curl -X GET http://localhost:5000/api/csrf-token -c cookies.txt

# Use token in protected request
curl -X POST http://localhost:5000/api/auth/firebase/logout \
  -b cookies.txt \
  -H "X-CSRF-Token: <token-from-cookie>" \
  -H "Content-Type: application/json"
```

### 2. Frontend Testing
```javascript
// Test CSRF token retrieval
const testCSRF = async () => {
  try {
    const response = await fetch('/api/csrf-token', {
      credentials: 'include'
    });
    const data = await response.json();
    console.log('CSRF Token:', data.csrfToken);
  } catch (error) {
    console.error('CSRF test failed:', error);
  }
};
```

## Security Considerations

1. **Token Refresh**: Tokens automatically refresh every 30 minutes
2. **Secure Cookies**: CSRF tokens use secure, strict SameSite cookies
3. **Header Validation**: Double-submit pattern validates both cookie and header
4. **Error Recovery**: Automatic retry with token refresh on validation failures

## Development Mode

For development, you can bypass CSRF (not recommended):
```env
NODE_ENV=development
CSRF_DEV_BYPASS=true
```

## Production Checklist

- [ ] CSRF tokens are properly included in all protected requests
- [ ] Axios interceptors handle token refresh automatically
- [ ] Error handling provides user-friendly CSRF error messages
- [ ] Session management coordinates with CSRF token lifecycle
- [ ] All authentication flows include CSRF token validation