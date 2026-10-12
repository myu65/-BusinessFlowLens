import { createCanvas, Path2D } from '@napi-rs/canvas';
import { diagramColors, diagramDrawio, diagramJson, diagramLegend, diagramNodeText, diagramPage, diagramPathPoints, validateDiagramExport, wrapDiagramText, xmlEscape, type DiagramExport } from './diagram-export';
import { ensurePdfFonts } from './pdf-fonts';

export type DiagramFormat = 'png' | 'drawio.png' | 'svg' | 'drawio' | 'json';
export const diagramFormats: DiagramFormat[] = ['png', 'drawio.png', 'svg', 'drawio', 'json'];
const font = '"Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

function pageFor(model: DiagramExport) {
  const page = diagramPage(model);
  if (page.width * page.height * 4 > 16_000_000 || page.width > 5000 || page.height > 5000) throw new Error('画像が大きすぎます。表示範囲を小さくして出力してください。');
  return page;
}

export function diagramSvg(model: DiagramExport) {
  validateDiagramExport(model);
  const page = pageFor(model);
  const colors = Object.entries(diagramColors);
  const header = `<text x="24" y="37" font-size="18" font-weight="600">${xmlEscape(wrapDiagramText(model.title, Math.floor((page.width - 48) / 18), 1)[0] ?? '')}</text><text x="24" y="63" font-size="11">${xmlEscape(`${model.scope.label}・${model.scope.state}`)}</text><text x="24" y="88" font-size="10">${xmlEscape(diagramLegend(model))}</text>`;
  const lines = model.view.connections.map(edge => {
    const color = diagramColors[edge.tone], short = wrapDiagramText(edge.label, 12, 1)[0] ?? '', width = Math.max(24, [...short].length * 10 + 10);
    return `<g><path d="${edge.path}" fill="none" stroke="${color.stroke}" stroke-width="1.6"${edge.uncertain ? ' stroke-dasharray="4 3"' : ''} marker-end="url(#arrow-${edge.tone})"/>${short ? `<rect x="${edge.x - width / 2}" y="${edge.y - 10}" width="${width}" height="16" rx="3" fill="#ffffff"/><text x="${edge.x}" y="${edge.y + 2}" text-anchor="middle" font-size="10" fill="${color.text}">${xmlEscape(short)}</text>` : ''}</g>`;
  });
  const nodes = model.view.nodes.map(node => {
    const color = diagramColors[node.tone];
    return `<g transform="translate(${node.x} ${node.y})"><rect width="${node.width}" height="${node.height}" rx="6" fill="${color.fill}" stroke="${color.stroke}"${node.uncertain ? ' stroke-dasharray="4 3"' : ''}/>${diagramNodeText(node).map(line => `<text x="10" y="${line.y}" font-size="${line.size}"${line.bold ? ' font-weight="600"' : ''} fill="${color.text}">${xmlEscape(line.text)}</text>`).join('')}</g>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" font-family="${xmlEscape(font)}" fill="#304e3d"><title>${xmlEscape(model.title)}</title><metadata id="businessflowlens">${xmlEscape(diagramJson(model))}</metadata><rect width="100%" height="100%" fill="#ffffff"/><defs>${colors.map(([tone, color]) => `<marker id="arrow-${tone}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${color.stroke}"/></marker>`).join('')}</defs>${header}<g transform="translate(${page.x} ${page.y})">${lines.join('')}${nodes.join('')}</g>${page.notes.map((text, i) => `<text x="24" y="${page.footY + 17 + i * 17}" font-size="11">${xmlEscape(text)}</text>`).join('')}</svg>`;
}

async function diagramPng(model: DiagramExport) {
  await ensurePdfFonts();
  const page = pageFor(model), canvas = createCanvas(Math.ceil(page.width * 2), Math.ceil(page.height * 2)), ctx = canvas.getContext('2d');
  ctx.scale(2, 2); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, page.width, page.height);
  // The bundled Noto files are variable fonts whose default axis is thin.
  const setFont = (size: number, weight = 400) => { ctx.font = `${weight} ${size}px "Noto Sans JP"`; ctx.fontVariationSettings = `"wght" ${weight}`; };
  ctx.fillStyle = '#304e3d'; setFont(18, 600); ctx.fillText(wrapDiagramText(model.title, Math.floor((page.width - 48) / 18), 1)[0] ?? '', 24, 37);
  setFont(11); ctx.fillText(`${model.scope.label}・${model.scope.state}`, 24, 63);
  setFont(10); ctx.fillText(diagramLegend(model), 24, 88);
  ctx.save(); ctx.translate(page.x, page.y);
  for (const edge of model.view.connections) {
    const color = diagramColors[edge.tone]; ctx.strokeStyle = color.stroke; ctx.lineWidth = 1.6; ctx.setLineDash(edge.uncertain ? [4, 3] : []); ctx.stroke(new Path2D(edge.path)); ctx.setLineDash([]);
    const points = diagramPathPoints(edge.path), end = points.at(-1)!, previous = [...points].reverse().find(point => point.x !== end.x || point.y !== end.y) ?? end;
    const angle = Math.atan2(end.y - previous.y, end.x - previous.x);
    ctx.fillStyle = color.stroke; ctx.beginPath(); ctx.moveTo(end.x, end.y); ctx.lineTo(end.x - 8 * Math.cos(angle - .45), end.y - 8 * Math.sin(angle - .45)); ctx.lineTo(end.x - 8 * Math.cos(angle + .45), end.y - 8 * Math.sin(angle + .45)); ctx.closePath(); ctx.fill();
    if (edge.label) { const short = wrapDiagramText(edge.label, 12, 1)[0] ?? ''; setFont(10); const width = ctx.measureText(short).width + 10;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(edge.x - width / 2, edge.y - 10, width, 16); ctx.fillStyle = color.text; ctx.textAlign = 'center'; ctx.fillText(short, edge.x, edge.y + 2); ctx.textAlign = 'left'; }
  }
  for (const node of model.view.nodes) {
    const color = diagramColors[node.tone]; ctx.fillStyle = color.fill; ctx.strokeStyle = color.stroke; ctx.lineWidth = 1; ctx.setLineDash(node.uncertain ? [4, 3] : []);
    ctx.beginPath(); ctx.roundRect(node.x, node.y, node.width, node.height, 6); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color.text;
    for (const line of diagramNodeText(node)) { setFont(line.size, line.bold ? 600 : 400); ctx.fillText(line.text, node.x + 10, node.y + line.y); }
  }
  ctx.restore(); ctx.fillStyle = '#52645b'; setFont(11);
  page.notes.forEach((text, i) => ctx.fillText(text, 24, page.footY + 17 + i * 17));
  return canvas.toBuffer('image/png');
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
  return (crc ^ 0xffffffff) >>> 0;
}

/** draw.io's official writer stores URI-encoded XML in a PNG tEXt/mxfile chunk. */
export function embedDrawioPng(png: Buffer, xml: string) {
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('PNG画像を読み取れません。');
  const type = Buffer.from('tEXt'), payload = Buffer.from(`mxfile\0${encodeURIComponent(xml)}`, 'latin1');
  const chunk = Buffer.alloc(payload.length + 12); chunk.writeUInt32BE(payload.length, 0); type.copy(chunk, 4); payload.copy(chunk, 8); chunk.writeUInt32BE(crc32(Buffer.concat([type, payload])), payload.length + 8);
  let position = 8;
  while (position + 12 <= png.length) { const length = png.readUInt32BE(position), kind = png.toString('ascii', position + 4, position + 8);
    if (position + length + 12 > png.length) break;
    // draw.io reads diagram metadata before the first image-data chunk.
    if (kind === 'IDAT') return Buffer.concat([png.subarray(0, position), chunk, png.subarray(position)]);
    position += length + 12;
  }
  throw new Error('PNG画像のデータを読み取れません。');
}

export async function renderDiagramExport(model: DiagramExport, format: DiagramFormat) {
  validateDiagramExport(model);
  if (format === 'json') return { bytes: Buffer.from(JSON.stringify(model, null, 2)), mime: 'application/json' };
  if (format === 'drawio') return { bytes: Buffer.from(diagramDrawio(model)), mime: 'application/xml' };
  if (format === 'svg') return { bytes: Buffer.from(diagramSvg(model)), mime: 'image/svg+xml' };
  const png = await diagramPng(model), bytes = format === 'drawio.png' ? embedDrawioPng(png, diagramDrawio(model)) : png;
  if (bytes.length > 8 * 1024 * 1024) throw new Error('出力ファイルが大きすぎます。表示範囲を小さくして出力してください。');
  return { bytes, mime: 'image/png' };
}
