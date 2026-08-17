import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './i18n';
import './styles/base.css';
import { installTelemetryDevtools, trackSessionStart } from './telemetry';

installTelemetryDevtools();
trackSessionStart();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
