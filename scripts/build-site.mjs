// Assembles the GitHub Pages site into _site/:
//   _site/          landing page (site/)
//   _site/media/    screenshots and GIFs (docs/media/)
//   _site/play/     the game itself, built with relative paths
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';

rmSync('_site', { recursive: true, force: true });
execSync('npx vite build --base ./ --outDir _site/play --emptyOutDir', { stdio: 'inherit' });
cpSync('site', '_site', { recursive: true });
cpSync('docs/media', '_site/media', { recursive: true });
console.log('Site ready in _site/');
