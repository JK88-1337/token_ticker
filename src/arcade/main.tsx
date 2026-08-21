import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ArcadeApp } from './Arcade.js';
import './arcade.css';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <ArcadeApp />
  </StrictMode>,
);
