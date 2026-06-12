import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'



// Apply saved theme before render to avoid flash
const savedTheme = localStorage.getItem('theme') || 'dark';
const root = document.documentElement;
const nativePlatform = window.Capacitor?.getPlatform?.();

if (nativePlatform === 'android') {
  root.classList.add('native-android');
}

if (savedTheme === 'auto') {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.classList.add(prefersDark ? 'dark' : 'light');
} else {
  root.classList.add(savedTheme === 'light' ? 'light' : 'dark');
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
