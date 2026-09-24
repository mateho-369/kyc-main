import React from 'react';
import { usePageTracking, useErrorTracking, usePerformanceTracking, useEngagementTracking } from '../hooks/useAnalytics';

const AnalyticsProvider = ({ children }) => {
  // Activate all analytics tracking hooks
  usePageTracking();
  useErrorTracking();
  usePerformanceTracking();
  useEngagementTracking();

  return <>{children}</>;
};

export default AnalyticsProvider;