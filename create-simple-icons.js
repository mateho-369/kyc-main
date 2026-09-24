const fs = require('fs');
const path = require('path');

// Simple SVG icon creator
function createSVGIcon(size) {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${size * 0.1}" fill="#3498db"/>
  <text x="50%" y="50%" font-family="Arial, sans-serif" font-size="${size * 0.35}" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">ID</text>
</svg>`;
  return svg;
}

// Create SVG files (as fallback)
const sizes = [192, 512, 96];
const publicDir = path.join(__dirname, 'public');

sizes.forEach(size => {
  const svgContent = createSVGIcon(size);
  const filename = path.join(publicDir, `icon-${size}.svg`);
  fs.writeFileSync(filename, svgContent);
  console.log(`Created ${filename}`);
});

// For now, copy SVG as PNG (browsers will still render them)
sizes.forEach(size => {
  const svgPath = path.join(publicDir, `icon-${size}.svg`);
  const pngPath = path.join(publicDir, `icon-${size}.png`);
  
  // Create a simple bitmap representation (base64 encoded PNG)
  // This is a 1x1 blue pixel as placeholder
  const base64PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const buffer = Buffer.from(base64PNG, 'base64');
  
  // For actual use, we'll need proper icons, but this prevents 404 errors
  fs.writeFileSync(pngPath, buffer);
  console.log(`Created placeholder ${pngPath}`);
});

console.log('✅ Icon files created to prevent 404 errors');
console.log('⚠️  Note: These are placeholder icons. Please replace with proper PNG icons.');