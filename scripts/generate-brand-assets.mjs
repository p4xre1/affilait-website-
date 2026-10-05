import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const brandMark = await readFile(path.join(publicDirectory, 'brand-mark.svg'));
const socialCard = await readFile(path.join(publicDirectory, 'social-card.svg'));

await Promise.all([
  sharp(brandMark, { density: 72 })
    .resize(512, 512, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(publicDirectory, 'brand-mark.png')),
  sharp(socialCard, { density: 72 })
    .resize(1200, 630, { fit: 'contain' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(path.join(publicDirectory, 'social-card.png')),
]);

console.log('Regenerated brand-mark.png and social-card.png from their SVG sources.');
