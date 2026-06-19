import './style.css';
import { Shell } from './shell/Shell';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

new Shell(root);

// Register the PWA service worker in production builds only (keeps dev/HMR clean).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
