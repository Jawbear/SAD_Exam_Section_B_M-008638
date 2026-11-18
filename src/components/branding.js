import { escapeHtml as h } from './ui.js';

const images = Object.entries(import.meta.glob('/{image,images}/**/*.{png,jpg,jpeg,svg,webp,PNG,JPG,JPEG,SVG,WEBP}', {
  eager: true, import: 'default', query: '?url',
})).sort(([left], [right]) => left.localeCompare(right));

function findAsset(names) {
  for (const folder of ['/image/', '/images/']) {
    for (const name of names) {
      const match = images.find(([path]) => path.startsWith(folder) && name.test(path.split('/').at(-1)));
      if (match) return match[1];
    }
  }
  return '';
}

export const logo = findAsset([/^logo\./i, /logo|seal|crest/i]);
export const loginPhoto = findAsset([/^(?:bg-login|login-bg)\./i, /login|campus|banner/i]);

export function brand() {
  return `<div class="brand">
    ${logo ? `<img class="brand-mark" src="${h(logo)}" width="48" height="48" alt="Agusan del Sur State University logo" decoding="async">`
      : '<span class="brand-mark brand-fallback" aria-hidden="true">SO</span>'}
    <span><strong>Scholarship Office</strong><small>Academic Compliance</small></span>
  </div>`;
}

export function setFavicon() {
  if (!logo) return;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = logo;
  document.head.append(link);
}
