import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BlocksApp } from './Blocks.js';

const container = document.getElementById('root');
if (!container) throw new Error('missing #root');

createRoot(container).render(
  <StrictMode>
    <BlocksApp />
  </StrictMode>,
);
