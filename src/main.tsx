import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './styles/projects.css';
import './styles/chapters.css';
import './styles/workspace.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('找不到应用根节点。');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
