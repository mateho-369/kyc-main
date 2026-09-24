import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
// import { trackPageView, trackEvent, ANALYTICS_EVENTS } from '../services/firebaseAnalytics';

// Custom hook for automatic page view tracking
export const usePageTracking = () => {
  const location = useLocation();

  useEffect(() => {
    // Track page view on route change
    const pageName = location.pathname.split('/').filter(Boolean).join(' > ') || 'Home';
    trackPageView(pageName, location.pathname + location.search);
  }, [location]);
};

// Custom hook for error boundary analytics
export const useErrorTracking = () => {
  useEffect(() => {
    // Global error handler
    const handleError = (event) => {
      trackEvent(ANALYTICS_EVENTS.ERROR_OCCURRED, {
        error_message: event.error?.message || 'Unknown error',
        error_stack: event.error?.stack,
        error_type: 'unhandled_error',
        page_url: window.location.href
      });
    };

    // Unhandled promise rejection handler
    const handleUnhandledRejection = (event) => {
      trackEvent(ANALYTICS_EVENTS.ERROR_OCCURRED, {
        error_message: event.reason?.message || event.reason || 'Unhandled promise rejection',
        error_stack: event.reason?.stack,
        error_type: 'unhandled_rejection',
        page_url: window.location.href
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
};

// Custom hook for performance tracking
export const usePerformanceTracking = () => {
  useEffect(() => {
    // Track page load performance
    if (window.performance && window.performance.timing) {
      const timing = window.performance.timing;
      const loadTime = timing.loadEventEnd - timing.navigationStart;
      
      if (loadTime > 0) {
        trackEvent('performance_metric', {
          metric_name: 'page_load_time',
          value: loadTime,
          unit: 'ms',
          page_url: window.location.href
        });
      }
    }

    // Track first contentful paint
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            trackEvent('performance_metric', {
              metric_name: 'first_contentful_paint',
              value: Math.round(entry.startTime),
              unit: 'ms',
              page_url: window.location.href
            });
          }
        }
      });

      try {
        observer.observe({ entryTypes: ['paint'] });
      } catch (e) {
        // Some browsers don't support this
      }

      return () => {
        observer.disconnect();
      };
    }
  }, []);
};

// Custom hook for user engagement tracking
export const useEngagementTracking = () => {
  useEffect(() => {
    let startTime = Date.now();
    let isActive = true;

    // Track time spent on page
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (isActive) {
          const timeSpent = Date.now() - startTime;
          trackEvent('user_engagement', {
            engagement_type: 'time_on_page',
            value: timeSpent,
            unit: 'ms',
            page_url: window.location.href
          });
          isActive = false;
        }
      } else {
        startTime = Date.now();
        isActive = true;
      }
    };

    // Track scroll depth
    let maxScrollDepth = 0;
    const handleScroll = () => {
      const scrollPercentage = Math.round(
        ((window.scrollY + window.innerHeight) / document.documentElement.scrollHeight) * 100
      );
      
      if (scrollPercentage > maxScrollDepth) {
        maxScrollDepth = scrollPercentage;
        
        // Track milestones
        if (maxScrollDepth >= 25 && maxScrollDepth < 50) {
          trackEvent('scroll_depth', { depth: 25, page_url: window.location.href });
        } else if (maxScrollDepth >= 50 && maxScrollDepth < 75) {
          trackEvent('scroll_depth', { depth: 50, page_url: window.location.href });
        } else if (maxScrollDepth >= 75 && maxScrollDepth < 90) {
          trackEvent('scroll_depth', { depth: 75, page_url: window.location.href });
        } else if (maxScrollDepth >= 90) {
          trackEvent('scroll_depth', { depth: 90, page_url: window.location.href });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('scroll', handleScroll);
      
      // Track final time spent when component unmounts
      if (isActive) {
        const timeSpent = Date.now() - startTime;
        trackEvent('user_engagement', {
          engagement_type: 'time_on_page',
          value: timeSpent,
          unit: 'ms',
          page_url: window.location.href
        });
      }
    };
  }, []);
};