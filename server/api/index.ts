/**
 * Vercel Function entry point: the whole Express app as one function.
 * server/vercel.json rewrites every path here; Express still sees the original URL.
 * Local development and Render use src/index.ts (app.listen) instead.
 */
import { createApp } from '../src/app';

export default createApp();
