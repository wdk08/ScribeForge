const imageCache = new Map();
function image(source) {
  if (!source) return Promise.resolve(null);
  if (!imageCache.has(source)) {
    if (imageCache.size >= 24) imageCache.delete(imageCache.keys().next().value);
    const picture = new Image();
    picture.src = source;
    imageCache.set(source, picture.decode().then(() => picture));
  }
  return imageCache.get(source);
}

export async function importArtwork(file) {
  if (!file || !/^image\/(png|jpeg|webp|gif)$/.test(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error('Choose a PNG, JPEG, WebP, or GIF image up to 20 MB.');
  }
  const url = URL.createObjectURL(file);
  try {
    const picture = new Image();
    picture.src = url;
    await picture.decode();
    const scale = Math.min(1, 2600 / Math.max(picture.naturalWidth, picture.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    canvas.getContext('2d').drawImage(picture, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', .93);
  } finally { URL.revokeObjectURL(url); }
}

export function coverBox(element, dimensions) {
  return {
    x: element.x * dimensions.width, y: element.y * dimensions.height,
    width: element.width * dimensions.width, height: element.height * dimensions.height,
  };
}

function drawImage(context, picture, box, crop) {
  const scale = (crop ? Math.max : Math.min)(box.width / picture.naturalWidth, box.height / picture.naturalHeight);
  const width = picture.naturalWidth * scale;
  const height = picture.naturalHeight * scale;
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.width, box.height);
  context.clip();
  context.drawImage(picture, box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height);
  context.restore();
}

function drawText(context, item, box) {
  context.save();
  context.beginPath();
  context.rect(box.x, box.y, box.width, box.height);
  context.clip();
  context.fillStyle = item.color;
  context.font = `${item.italic ? 'italic ' : ''}${item.bold ? 'bold ' : ''}${item.size}px "${item.font}", serif`;
  context.textBaseline = 'top';
  const lineHeight = item.size * 1.2;
  let top = box.y;
  const draw = line => {
    context.fillText(line, box.x, top);
    if (item.underline) context.fillRect(box.x, top + item.size, context.measureText(line).width, Math.max(1, item.size / 15));
    top += lineHeight;
  };
  for (const paragraph of item.text.split('\n')) {
    let line = '';
    for (const word of paragraph.match(/\S+|\s+/gu) ?? []) {
      if (line && context.measureText(line + word).width > box.width) { draw(line.trimEnd()); line = ''; }
      if (!line && /^\s+$/u.test(word)) continue;
      if (context.measureText(word).width > box.width) {
        for (const char of word) {
          if (line && context.measureText(line + char).width > box.width) { draw(line); line = ''; }
          line += char;
        }
      } else line += word;
    }
    draw(line);
    if (top > box.y + box.height) break;
  }
  context.restore();
}

export async function drawCover(canvas, cover, dimensions, { preview = false, selected = null } = {}) {
  const sources = [cover.backgroundImage, ...cover.elements.filter(item => item.type === 'image').map(item => item.src)];
  const pictures = new Map(await Promise.all(sources.map(async source => [source, await image(source)])));
  const { width, height, panels } = dimensions;
  const bleed = cover.bleed;
  const fullWidth = width + bleed * 2;
  const fullHeight = height + bleed * 2;
  const scale = Math.min(preview ? 1.6 : 300 / 72, 6000 / Math.max(fullWidth, fullHeight),
    Math.sqrt(16_000_000 / (fullWidth * fullHeight)));
  canvas.width = Math.ceil(fullWidth * scale);
  canvas.height = Math.ceil(fullHeight * scale);
  const context = canvas.getContext('2d');
  context.setTransform(canvas.width / fullWidth, 0, 0, canvas.height / fullHeight, bleed * canvas.width / fullWidth, bleed * canvas.height / fullHeight);
  context.fillStyle = cover.background;
  context.fillRect(-bleed, -bleed, fullWidth, fullHeight);
  if (cover.backgroundImage) drawImage(context, pictures.get(cover.backgroundImage), { x: -bleed, y: -bleed, width: fullWidth, height: fullHeight }, true);
  for (const item of cover.elements) {
    const box = coverBox(item, dimensions);
    if (item.type === 'text') drawText(context, item, box);
    else if (item.type === 'image') drawImage(context, pictures.get(item.src), box, false);
    else {
      context.fillStyle = item.color;
      if (item.type === 'rect') context.fillRect(box.x, box.y, box.width, box.height);
      else {
        context.beginPath();
        context.ellipse(box.x + box.width / 2, box.y + box.height / 2, box.width / 2, box.height / 2, 0, 0, 2 * Math.PI);
        context.fill();
      }
    }
  }
  if (preview) {
    context.lineWidth = 1.5;
    for (const panel of panels) {
      context.strokeStyle = '#49339a';
      context.strokeRect(panel.x, 0, panel.width, height);
      if (cover.guides && cover.safe && panel.width > 2 * cover.safe && height > 2 * cover.safe) {
        context.setLineDash([4, 5]);
        context.strokeRect(panel.x + cover.safe, cover.safe, panel.width - 2 * cover.safe, height - 2 * cover.safe);
        context.setLineDash([]);
      }
    }
    if (selected) {
      const box = coverBox(selected, dimensions);
      context.strokeStyle = '#49339a';
      context.strokeRect(box.x, box.y, box.width, box.height);
      context.fillStyle = '#49339a';
      context.fillRect(box.x + box.width - 5, box.y + box.height - 5, 10, 10);
    }
  }
}

export async function coverExport(cover, dimensions, format) {
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  await drawCover(canvas, cover, dimensions);
  if (format === 'png') {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('The cover could not be rendered as PNG.');
    return new Uint8Array(await blob.arrayBuffer());
  }
  const { jsPDF } = await import('jspdf');
  const width = dimensions.width + 2 * cover.bleed;
  const height = dimensions.height + 2 * cover.bleed;
  const pdf = new jsPDF({ unit: 'pt', format: [width, height], orientation: width > height ? 'landscape' : 'portrait', compress: true });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
  return new Uint8Array(pdf.output('arraybuffer'));
}
