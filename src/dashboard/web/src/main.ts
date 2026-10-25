// The dashboard board (2-2): a read-only window on GET /api/board and the SSE stream.
import { mount } from 'svelte';
import App from './App.svelte';
import './lib/tokens.css';

const target = document.getElementById('app');
if (target) mount(App, { target });
