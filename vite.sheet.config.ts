import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vite';
import { usageApi } from './vite.usage-plugin.js';

/**
 * The two character-sheet skins, on one dev server.
 *
 * `gauge.html` and `blocks.html` are the same information architecture in two
 * art directions, so they share a config rather than each having their own.
 * The npm scripts differ only in which one they open and which port they take,
 * which means both can run at once for a side-by-side.
 */
function chooser(): Plugin {
  return {
    name: 'sheet-chooser',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== '/' && path !== '/index.html') return next();

        // Falling through would serve index.html — the production dashboard —
        // on a port that is meant to be a prototype. Better to say what lives
        // here than to quietly show something else.
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(`<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<title>token sheets</title>
<style>
  body { margin:0; min-height:100vh; display:grid; place-items:center; gap:0;
         background:#101014; color:#eceae4; font:15px/1.6 system-ui, sans-serif; }
  ul { list-style:none; padding:0; margin:0; display:grid; gap:12px; }
  a { color:#eceae4; text-decoration:none; border:1px solid #34343e; padding:14px 20px;
      display:block; min-width:280px; }
  a:hover, a:focus-visible { border-color:#eceae4; outline:none; }
  b { display:block; font-size:17px; }
  span { color:#9a96a4; font-size:13px; }
</style></head>
<body><ul>
  <li><a href="/gauge.html"><b>gauge</b><span>precision instrument — hairlines, tabular figures</span></a></li>
  <li><a href="/blocks.html"><b>blocks</b><span>neo-brutalist — hard rules, offset shadows</span></a></li>
</ul></body></html>
`);
      });
    },
  };
}

export default defineConfig({
  plugins: [chooser(), react(), usageApi()],
  server: { strictPort: true },
});
