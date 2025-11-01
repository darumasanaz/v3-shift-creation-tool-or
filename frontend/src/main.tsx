import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initializeStorageSchema } from './lib/storageSchema';
import { TargetMonthProvider } from './state/MonthContext';

initializeStorageSchema();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <TargetMonthProvider>
      <App />
    </TargetMonthProvider>
  </React.StrictMode>,
);
