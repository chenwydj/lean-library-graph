// Offline, dependency-free PDF export. The browser paints the SVG so Lean's
// Unicode labels and the active colors match the graph, without PDF font mapping.
// A high-resolution JPEG is embedded in a single page; SVG remains the vector export.
const encode = text => new TextEncoder().encode(text);

export function jpegPdf(jpeg, width, height) {
  if (!(jpeg instanceof Uint8Array) || !jpeg.length || !Number.isInteger(width) ||
      !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('Invalid PDF image');
  const scale = 1200 / Math.max(width, height);
  const w = (width * scale).toFixed(3), h = (height * scale).toFixed(3);
  const commands = `q\n${w} 0 0 ${h} 0 0 cm\n/Graph Do\nQ\n`;
  const parts = [], offsets = [0];
  let length = 0;
  function add(value) {
    const bytes = typeof value === 'string' ? encode(value) : value;
    parts.push(bytes); length += bytes.length;
  }
  function object(id, value) {
    offsets[id] = length; add(`${id} 0 obj\n${value}\nendobj\n`);
  }
  add('%PDF-1.4\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Graph 4 0 R >> >> /Contents 5 0 R >>`);
  offsets[4] = length;
  add(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  add(jpeg); add('\nendstream\nendobj\n');
  object(5, `<< /Length ${encode(commands).length} >>\nstream\n${commands}endstream`);
  const xref = length;
  add('xref\n0 6\n0000000000 65535 f \n');
  for (const offset of offsets.slice(1)) add(`${String(offset).padStart(10, '0')} 00000 n \n`);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, {type:'application/pdf'});
}

// Shared image renderer for PDF downloads and PNG clipboard copies.
async function rasterizeGraph(svg, layout, type) {
  const copy = svg.cloneNode(true);
  // Presentation attributes avoid external stylesheets and inline-style CSP rules.
  // Capture the render before awaiting anything, so filter changes cannot mix states.
  const originals = svg.querySelectorAll('*'), clones = copy.querySelectorAll('*');
  const properties = ['fill','fill-opacity','stroke','stroke-opacity','stroke-width',
    'stroke-dasharray','opacity','font-family','font-size','font-weight','letter-spacing'];
  originals.forEach((el, i) => {
    const style = getComputedStyle(el);
    for (const property of properties) clones[i].setAttribute(property,style.getPropertyValue(property));
  });
  copy.removeAttribute('id'); copy.removeAttribute('class'); copy.removeAttribute('tabindex');
  copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
  // Fit the entire filtered layout, with a margin, regardless of pan or zoom.
  const w = layout.w + 32, h = layout.h + 32;
  const density = Math.min(3, 8192 / Math.max(w,h), Math.sqrt(32000000 / (w*h)));
  const width = Math.max(1,Math.round(w*density)), height = Math.max(1,Math.round(h*density));
  copy.setAttribute('viewBox',`-16 -16 ${w} ${h}`);
  copy.setAttribute('width',String(width)); copy.setAttribute('height',String(height));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)],{type:'image/svg+xml'}));
  try {
    await document.fonts.ready;
    const image = new Image();
    await new Promise((resolve,reject) => {
      image.onload=resolve; image.onerror=()=>reject(new Error('Could not render graph image')); image.src=url;
    });
    const canvas = document.createElement('canvas'); canvas.width=width; canvas.height=height;
    const context = canvas.getContext('2d');
    if(!context)throw new Error('Canvas rendering is unavailable');
    context.fillStyle='#fff'; context.fillRect(0,0,width,height); context.drawImage(image,0,0,width,height);
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,type,0.96));
    if(!blob)throw new Error('Could not encode graph image');
    return {blob,width,height};
  } finally { URL.revokeObjectURL(url); }
}

export async function graphImage(svg, layout) {
  return (await rasterizeGraph(svg,layout,'image/png')).blob;
}

export async function graphPdf(svg, layout) {
  const {blob,width,height}=await rasterizeGraph(svg,layout,'image/jpeg');
  return jpegPdf(new Uint8Array(await blob.arrayBuffer()),width,height);
}
