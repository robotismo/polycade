import './style.css';
import { Shell } from './shell/Shell';

const root = document.getElementById('app');
if (!root) throw new Error('#app root not found');

new Shell(root);
