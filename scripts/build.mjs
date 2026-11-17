import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function buildApp() {
  await rm('dist', { recursive: true, force: true });
  await mkdir('dist/assets', { recursive: true });
  const result = await build({ entryPoints: ['src/client/app.js'], bundle: true, format: 'esm', target: ['es2022'], minify: true, outdir: 'dist/assets', entryNames: 'app-[hash]', sourcemap: true, metafile: true });
  const js = '/' + Object.keys(result.metafile.outputs).find(path => path.endsWith('.js')).replace(/^dist\//, '');
  const css = await readFile('src/client/styles.css');
  const cssPath = `/assets/app-${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`;
  await writeFile('dist' + cssPath, css);
  const seed = JSON.parse(await readFile('workouts.json', 'utf8'));
  await writeFile('dist/workouts.json', JSON.stringify({ days: seed.days }));
  const icons = ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
  await mkdir('dist/icons', { recursive: true });
  for (const file of ['manifest.webmanifest', 'icon.svg', ...icons.map(icon => `icons/${icon}`)]) await copyFile(`public/${file}`, `dist/${file}`);
  const sourceHTML = await readFile('index.html', 'utf8'), worker = await readFile('public/sw.js', 'utf8');
  const hash = createHash('sha256').update(sourceHTML).update(worker);
  for (const file of [js.slice(1), cssPath.slice(1), 'workouts.json', 'manifest.webmanifest', 'icon.svg', ...icons.map(icon => `icons/${icon}`)]) hash.update(await readFile(`dist/${file}`));
  const version = hash.digest('hex').slice(0, 12), manifest = `/manifest.webmanifest?v=${version}`;
  const html = sourceHTML.replace('/assets/app.js', js).replace('/assets/app.css', cssPath).replace('/manifest.webmanifest', manifest);
  await writeFile('dist/index.html', html);
  const assets = ['/', '/index.html', js, cssPath, '/workouts.json', manifest, '/icon.svg', ...icons.map(icon => `/icons/${icon}`)];
  await writeFile('dist/sw.js', worker.replace('__BUILD_VERSION__', version).replace('__PRECACHE_ASSETS__', JSON.stringify(assets)));
  return version;
}
if (process.argv[1]?.endsWith('/build.mjs')) console.log('Built FORM', await buildApp());
