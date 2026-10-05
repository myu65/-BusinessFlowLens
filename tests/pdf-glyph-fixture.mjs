import assert from 'node:assert/strict';
import sharp from 'sharp';

/** One unembedded Japanese CID glyph. A square replacement must fail the image check. */
export function japaneseGlyphPDF() {
  const content='BT /FJ 60 Tf 20 30 Td <4E00> Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Resources << /Font << /FJ 4 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UTF16-H /DescendantFonts [5 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 6 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] /Ascent 723 /Descent -241 /CapHeight 709 /StemV 69 >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let source='%PDF-1.4\n';const offsets=[0];
  for(const [index,object] of objects.entries()){offsets.push(Buffer.byteLength(source));source+=`${index+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(source);
  source+=`xref\n0 ${offsets.length}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>`${String(offset).padStart(10,'0')} 00000 n \n`).join('');
  source+=`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(source);
}

export async function assertJapaneseGlyphImage(bytes) {
  const {data,info}=await sharp(bytes).removeAlpha().raw().toBuffer({resolveWithObject:true});
  let left=info.width,right=-1,top=info.height,bottom=-1,pixels=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const offset=(y*info.width+x)*info.channels;
    if(data[offset]<100&&data[offset+1]<100&&data[offset+2]<100){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);pixels++;}
  }
  assert.ok(pixels>50,'the Japanese glyph must be visible rather than an empty page');
  assert.ok((right-left+1)/(bottom-top+1)>4,'一 must appear as a horizontal stroke rather than a square replacement glyph');
}
