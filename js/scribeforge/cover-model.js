export const pointsPerMillimeter = 72 / 25.4;
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const color = value => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
const raster = value => typeof value === 'string' && /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const keys = (object, names) => object && typeof object === 'object' && !Array.isArray(object) &&
  Object.keys(object).length === names.length && names.every(name => Object.hasOwn(object, name));

export const blankCover = () => ({
  layout: 'front', background: '#ffffff', backgroundImage: null,
  paper: 0.1, spine: null, bleed: 0, safe: 18, guides: true, elements: [],
});

export function validateCover(cover, fontName) {
  const fail = () => { throw new Error('The document contains invalid cover settings or artwork.'); };
  if (!keys(cover, ['layout', 'background', 'backgroundImage', 'paper', 'spine', 'bleed', 'safe', 'guides', 'elements']) ||
    !['front', 'two', 'wrap'].includes(cover.layout) || !color(cover.background) ||
    (cover.backgroundImage !== null && !raster(cover.backgroundImage)) ||
    !number(cover.paper, .01, 1) || (cover.spine !== null && !number(cover.spine, 0, 288)) ||
    !number(cover.bleed, 0, 36) || !number(cover.safe, 0, 144) || typeof cover.guides !== 'boolean' ||
    !Array.isArray(cover.elements) || cover.elements.length > 100) fail();
  let imageBytes = cover.backgroundImage?.length ?? 0;
  const ids = new Set();
  for (const element of cover.elements) {
    const { id, type, x, y, width, height } = element ?? {};
    if (typeof id !== 'string' || !/^[\w-]{1,120}$/.test(id) || ids.has(id) ||
      !number(x, 0, 1) || !number(y, 0, 1) || !number(width, .01, 1) || !number(height, .01, 1) ||
      x + width > 1.0000001 || y + height > 1.0000001) fail();
    ids.add(id);
    const geometry = ['id', 'type', 'x', 'y', 'width', 'height'];
    if (type === 'text') {
      if (!keys(element, [...geometry, 'text', 'font', 'size', 'color', 'bold', 'italic', 'underline']) ||
        typeof element.text !== 'string' || element.text.length > 4000 || !fontName(element.font) ||
        !number(element.size, 4, 288) || !color(element.color) ||
        !['bold', 'italic', 'underline'].every(key => typeof element[key] === 'boolean')) fail();
    } else if (type === 'image') {
      if (!keys(element, [...geometry, 'src']) || !raster(element.src)) fail();
      imageBytes += element.src.length;
    } else if (type === 'rect' || type === 'ellipse') {
      if (!keys(element, [...geometry, 'color']) || !color(element.color)) fail();
    } else fail();
  }
  if (imageBytes > 12 * 1024 * 1024) throw new Error('Cover images exceed the combined 12 MB artwork limit.');
}

export function coverDimensions(trim, pageCount, cover) {
  const { width, height } = trim;
  const wrap = cover.layout === 'wrap';
  const reliable = Number.isSafeInteger(pageCount) && pageCount >= 2;
  const spine = wrap ? cover.spine ?? (reliable ? Math.ceil(pageCount / 2) * cover.paper * pointsPerMillimeter : 0) : 0;
  const panels = cover.layout === 'front' ? [{ name: 'Front', x: 0, width }] : [
    { name: 'Back', x: 0, width },
    ...(wrap ? [{ name: 'Spine', x: width, width: spine }] : []),
    { name: 'Front', x: width + spine, width },
  ];
  return {
    width: panels.at(-1).x + width, height, spine, panels,
    warning: wrap && cover.spine === null && !reliable ? 'Add manuscript pages or enter a manual spine width.' : '',
  };
}
