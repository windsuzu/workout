import { build } from 'esbuild';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function buildApp() {
  await mkdir('dist/assets', { recursive: true });
  await build({ entryPoints: ['src/client/app.js'], bundle: true, format: 'esm', target: ['es2022'], minify: true, outfile: 'dist/assets/app.js', sourcemap: true });
  await copyFile('src/client/styles.css', 'dist/assets/app.css');
  await copyFile('index.html', 'dist/index.html');
  const seed = JSON.parse(await readFile('workouts.json', 'utf8'));
  await writeFile('dist/workouts.json', JSON.stringify({ days: seed.days }));
  await copyFile('public/manifest.webmanifest', 'dist/manifest.webmanifest');
  await copyFile('public/icon.svg', 'dist/icon.svg');
  const hash = createHash('sha256');
  for (const file of ['assets/app.js', 'assets/app.css', 'index.html', 'workouts.json', 'manifest.webmanifest', 'icon.svg']) hash.update(await readFile(`dist/${file}`));
  hash.update(await readFile('public/sw.js'));
  const version = hash.digest('hex').slice(0, 12);
  await writeFile('dist/sw.js', (await readFile('public/sw.js', 'utf8')).replace('__BUILD_VERSION__', version));
  return version;
}
if (process.argv[1]?.endsWith('/build.mjs')) console.log('Built FORM', await buildApp());
