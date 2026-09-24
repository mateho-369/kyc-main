import { getAnalytics, logEvent, setUserId, setUserProperties } from 'firebase/analytics';
import app from '../config/firebase';

// Initialize Analytics (only in production)
let analytics = null;
if (app && process.env.NODE_ENV === 'production') {
  analytics = getAnalytics(app);
}

// Event names constants
export const ANALYTICS_EVENTS = {
  // Authentication events
  LOGIN_ATTEMPT: 'login_attempt',
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILED: 'login_failed',
  LOGOUT: 'logout',
  SIGNUP_START: 'signup_start',
  SIGNUP_COMPLETE: 'signup_complete',
  
  // Performer registration events
  PERFORMER_REGISTRATION_START: 'performer_registration_start',
  PERFORMER_STEP_COMPLETED: 'performer_step_completed',
  PERFORMER_REGISTRATION_COMPLETE: 'performer_registration_complete',
  PERFORMER_REGISTRATION_ABANDONED: 'performer_registration_abandoned',
  
  // Document upload events
  DOCUMENT_UPLOAD_START: 'document_upload_start',
  DOCUMENT_UPLOAD_SUCCESS: 'document_upload_success',
  DOCUMENT_UPLOAD_FAILED: 'document_upload_failed',
  DOCUMENT_VERIFICATION_START: 'document_verification_start',
  DOCUMENT_VERIFICATION_COMPLETE: 'document_verification_complete',
  
  // User engagement events
  PAGE_VIEW: 'page_view',
  FEATURE_INTERACTION: 'feature_interaction',
  SEARCH_PERFORMED: 'search_performed',
  VIDEO_VIEWED: 'video_viewed',
  
  // Error tracking events
  ERROR_OCCURRED: 'error_occurred',
  API_ERROR: 'api_error',
  VALIDATION_ERROR: 'validation_error'
};

// Helper functions
export const trackEvent = (eventName, parameters = {}) => {
  try {
    // Firebase Analytics disabled for development
    if (process.env.NODE_ENV === 'development' || !analytics) {
      console.log('Analytics (dev):', eventName, parameters);
      return;
    }
    
    logEvent(analytics, eventName, {
      ...parameters,
      timestamp: new Date().toISOString(),
      user_agent: navigator.userAgent,
      platform: navigator.platform
    });
  } catch (error) {
    console.error('Analytics tracking error:', error);
  }
};

export const trackUserLogin = (userId, method, success = true) => {
  if (success) {
    // Firebase Analytics disabled for development
    if (process.env.NODE_ENV === 'development' || !analytics) {
      console.log('Analytics (dev): LOGIN_SUCCESS', { method, user_id: userId });
    } else {
      setUserId(analytics, userId);
    }
    trackEvent(ANALYTICS_EVENTS.LOGIN_SUCCESS, {
      method,
      user_id: userId
    });
  } else {
    trackEvent(ANALYTICS_EVENTS.LOGIN_FAILED, {
      method,
      error_type: 'authentication_failed'
    });
  }
};

export const trackPerformerRegistration = (step, stepData = {}) => {
  trackEvent(ANALYTICS_EVENTS.PERFORMER_STEP_COMPLETED, {
    step_name: step,
    step_number: stepData.stepNumber,
    ...stepData
  });
};

export const trackDocumentUpload = (documentType, fileSize, success = true, error = null) => {
  const eventName = success 
    ? ANALYTICS_EVENTS.DOCUMENT_UPLOAD_SUCCESS 
    : ANALYTICS_EVENTS.DOCUMENT_UPLOAD_FAILED;
  
  trackEvent(eventName, {
    document_type: documentType,
    file_size: fileSize,
    error_message: error ? error.message : null,
    error_code: error ? error.code : null
  });
};

export const trackError = (errorType, errorMessage, errorStack = null, context = {}) => {
  trackEvent(ANALYTICS_EVENTS.ERROR_OCCURRED, {
    error_type: errorType,
    error_message: errorMessage,
    error_stack: errorStack,
    page_url: window.location.href,
    ...context
  });
};

export const trackPageView = (pageName, pageUrl = null) => {
  trackEvent(ANALYTICS_EVENTS.PAGE_VIEW, {
    page_name: pageName,
    page_url: pageUrl || window.location.href,
    page_title: document.title
  });
};

export const setUserProfile = (userId, properties = {}) => {
  try {
    // Firebase Analytics disabled for development
    if (process.env.NODE_ENV === 'development' || !analytics) {
      console.log('Analytics (dev): setUserProfile', { userId, properties });
      return;
    }
    
    setUserId(analytics, userId);
    setUserProperties(analytics, {
      ...properties,
      last_active: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error setting user profile:', error);
  }
};

// Performance tracking
export const trackPerformance = (metricName, value, unit = 'ms') => {
  trackEvent('performance_metric', {
    metric_name: metricName,
    value,
    unit
  });
};

// Conversion tracking
export const trackConversion = (conversionType, value = null, currency = 'USD') => {
  trackEvent('conversion', {
    conversion_type: conversionType,
    value,
    currency
  });
};

export default {
  trackEvent,
  trackUserLogin,
  trackPerformerRegistration,
  trackDocumentUpload,
  trackError,
  trackPageView,
  setUserProfile,
  trackPerformance,
  trackConversion,
  ANALYTICS_EVENTS
};