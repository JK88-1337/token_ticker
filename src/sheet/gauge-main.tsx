import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { GaugeApp } from './Gauge.js';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <GaugeApp />
  </StrictMode>,
);
