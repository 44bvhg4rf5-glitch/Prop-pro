import { PDFDocument, StandardFonts } from 'pdf-lib';

// Render an array of letter texts into one multi-page PDF (one letter per page),
// returned as a base64 string (what PrintNode expects).
export async function lettersToPdfBase64(letters) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const size = 12, lineH = 18, margin = 64, pageW = 595, pageH = 842;
  const maxW = pageW - margin * 2;

  for (const text of letters) {
    let page = doc.addPage([pageW, pageH]);
    let y = pageH - margin;
    const newPage = () => { page = doc.addPage([pageW, pageH]); y = pageH - margin; };
    const draw = (line) => { if (y < margin) newPage(); page.drawText(line, { x: margin, y, size, font }); y -= lineH; };

    for (const para of String(text || '').split('\n')) {
      if (para === '') { y -= lineH; continue; }
      let line = '';
      for (const w of para.split(' ')) {
        const test = line ? line + ' ' + w : w;
        if (font.widthOfTextAtSize(test, size) > maxW) { draw(line); line = w; }
        else line = test;
      }
      if (line) draw(line);
    }
  }
  const bytes = await doc.save();
  return Buffer.from(bytes).toString('base64');
}
