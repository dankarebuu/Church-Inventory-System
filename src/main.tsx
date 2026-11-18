import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App, createAppQueryClient } from './App';

const queryClient = createAppQueryClient();
const rootElement = document.getElementById('root');

if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <App queryClient={queryClient} />
    </StrictMode>
  );
}
