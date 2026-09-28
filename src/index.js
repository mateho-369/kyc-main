import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './styles/workspace.css';
// Temporary fixtures require the separate build-time module substitution.
// Normal builds keep real authentication/services and omit the fixture entry.
const App = process.env.REACT_APP_UI_PREVIEW === 'true'
  ? (process.env.REACT_APP_FIXTURE_BUNDLE === 'true'
    ? require('./preview/RealPagesPreview').default
    : require('./preview/PreviewApp').default)
  : require('./App.jsx').default;

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
