import fs from 'fs';
import path from 'path';

console.log('[Safeguard] Verifying image assets and data URL integrity...');

const projectRoot = process.cwd();
const imagesDir = path.join(projectRoot, 'src', 'assets', 'images');
const srcAssetsDir = path.join(projectRoot, 'src', 'assets');
const publicDir = path.join(projectRoot, 'public');
const publicAssetsDir = path.join(publicDir, 'assets');

// Ensure directories exist
[imagesDir, srcAssetsDir, publicDir, publicAssetsDir].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Find best valid source image
let sourceImagePath = path.join(srcAssetsDir, 'landing-bg.jpg');

if (!fs.existsSync(sourceImagePath) || fs.statSync(sourceImagePath).size < 1000) {
  const candidateDirFiles = fs.readdirSync(imagesDir).filter((f) => f.endsWith('.jpg') || f.endsWith('.jpeg'));
  if (candidateDirFiles.length > 0) {
    sourceImagePath = path.join(imagesDir, candidateDirFiles[0]);
  }
}

if (!fs.existsSync(sourceImagePath) || fs.statSync(sourceImagePath).size < 1000) {
  console.error('[Safeguard Error] No valid landing background image source found!');
  process.exit(1);
}

const sourceBuffer = fs.readFileSync(sourceImagePath);
console.log(`[Safeguard] Source image found (${(sourceBuffer.length / 1024).toFixed(1)} KB)`);

// Sync copies across all static asset locations
const targets = [
  path.join(srcAssetsDir, 'landing-bg.jpg'),
  path.join(srcAssetsDir, 'image-00538.jpeg'),
  path.join(srcAssetsDir, 'IMG_0538.jpeg'),
  path.join(publicDir, 'landing-bg.jpg'),
  path.join(publicDir, 'image-00538.jpeg'),
  path.join(publicDir, 'IMG_0538.jpeg'),
  path.join(publicAssetsDir, 'image-00538.jpeg'),
  path.join(publicAssetsDir, 'IMG_0538.jpeg'),
];

targets.forEach((targetPath) => {
  try {
    if (!fs.existsSync(targetPath) || fs.statSync(targetPath).size !== sourceBuffer.length) {
      fs.writeFileSync(targetPath, sourceBuffer);
      console.log(`[Safeguard] Synced target asset: ${path.relative(projectRoot, targetPath)}`);
    }
  } catch (err) {
    console.warn(`[Safeguard Warning] Could not sync ${targetPath}:`, err.message);
  }
});

// Ensure base64 data URL module exists and is up to date
const dataTsPath = path.join(srcAssetsDir, 'landingBgData.ts');
const b64 = sourceBuffer.toString('base64');
const dataTsContent = `export const LANDING_BG_DATA_URL = "data:image/jpeg;base64,${b64}";\n`;

if (!fs.existsSync(dataTsPath) || fs.readFileSync(dataTsPath, 'utf8') !== dataTsContent) {
  fs.writeFileSync(dataTsPath, dataTsContent);
  console.log('[Safeguard] Regenerated inlined data URL module src/assets/landingBgData.ts');
}

console.log('[Safeguard] All landing page background protections verified successfully.');
