import { diagramFilename, validateDiagramExport } from '@/lib/diagram-export';
import { diagramFormats, renderDiagramExport, type DiagramFormat } from '@/lib/diagram-renderer';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024) return Response.json({ error: '図の情報が多すぎます。表示範囲を小さくして出力してください。' }, { status: 413 });
    const body = JSON.parse(raw) as { model: unknown; format: DiagramFormat };
    if (!body || !diagramFormats.includes(body.format)) return Response.json({ error: 'PNG・SVG・draw.io・構造データの形式を選んでください。' }, { status: 400 });
    validateDiagramExport(body.model);
    const output = await renderDiagramExport(body.model, body.format);
    return new Response(new Uint8Array(output.bytes), { headers: { 'Content-Type': output.mime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(diagramFilename(body.model.title, body.format))}`,
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? '出力する図の情報を読み取れませんでした。入力した話と図は残っています。' : error instanceof Error ? error.message : '図を出力できませんでした。入力した話と図は残っています。' }, { status: 400 });
  }
}
