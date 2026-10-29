'use strict';
// Eksport tekstu do .txt i .docx (bez zewnętrznych bibliotek, działa offline).

// Zamienia HTML edytora na listę akapitów: { center, runs: [{ text, italic } | { br: true }] }
function htmlToBlocks(html) {
  const root = document.createElement('div');
  root.innerHTML = html;
  const blocks = [];
  const isBlock = n => n.nodeType === 1 && /^(P|DIV|H[1-6]|LI|BLOCKQUOTE)$/.test(n.nodeName);
  const isCenter = n => /center/.test(n.style.textAlign) || n.getAttribute('align') === 'center';

  function collect(container, center) {
    let loose = null; // tekst leżący bezpośrednio w kontenerze, poza akapitem
    for (const node of container.childNodes) {
      if (isBlock(node)) {
        loose = null;
        const c = center || isCenter(node);
        if ([...node.childNodes].some(isBlock)) collect(node, c);
        else blocks.push({ center: c, runs: runsOf(node) });
      } else {
        if (!loose) { loose = { center, runs: [] }; blocks.push(loose); }
        walk(node, false, loose.runs);
      }
    }
  }

  function runsOf(el) {
    const runs = [];
    walk(el, false, runs);
    if (runs.length && runs[runs.length - 1].br) runs.pop(); // znacznik pustej linii w edytorze
    return runs;
  }

  function walk(node, italic, runs) {
    if (node.nodeType === 3) {
      if (node.data) runs.push({ text: node.data.replace(/ /g, ' '), italic });
    } else if (node.nodeName === 'BR') {
      runs.push({ br: true });
    } else if (node.nodeType === 1) {
      const it = italic || /^(I|EM)$/.test(node.nodeName) || node.style.fontStyle === 'italic';
      for (const child of node.childNodes) walk(child, it, runs);
    }
  }

  collect(root, false);
  return blocks;
}

function exportTxt(html) {
  const text = htmlToBlocks(html)
    .map(b => b.runs.map(r => (r.br ? '\n' : r.text)).join(''))
    .join('\n');
  return new Blob([text], { type: 'text/plain;charset=utf-8' });
}

function exportDocx(html, title) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const paragraphs = htmlToBlocks(html).map(b => {
    const text = b.runs.map(r => r.text || '').join('').trim();
    const pPr = b.center
      ? '<w:pPr><w:jc w:val="center"/></w:pPr>'
      : text ? '<w:pPr><w:ind w:firstLine="709"/></w:pPr>' : '';
    const runs = b.runs.map(r => r.br
      ? '<w:r><w:br/></w:r>'
      : `<w:r>${r.italic ? '<w:rPr><w:i/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(r.text)}</w:t></w:r>`
    ).join('');
    return `<w:p>${pPr}${runs}</w:p>`;
  }).join('');

  const files = {
    '[Content_Types].xml': XML +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>',
    '_rels/.rels': XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>',
    'docProps/core.xml': XML +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
      `<dc:title>${esc(title || '')}</dc:title></cp:coreProperties>`,
    'word/_rels/document.xml.rels': XML +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'word/styles.xml': XML +
      `<w:styles ${W}><w:docDefaults>` +
      '<w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' +
      '<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="pl-PL"/></w:rPr></w:rPrDefault>' +
      '<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
      '</w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>',
    'word/document.xml': XML +
      `<w:document ${W}><w:body>${paragraphs}` +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>' +
      '</w:body></w:document>',
  };
  return new Blob([zip(files)], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// Minimalny zapis ZIP (bez kompresji) – wystarcza dla .docx.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const local = [], central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);

    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    local.push(new Uint8Array(lh.buffer), nameBytes, data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length / 2, true);
  end.setUint16(10, central.length / 2, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...local, ...central, new Uint8Array(end.buffer)]);
}
