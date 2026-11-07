import { html } from './workflow-utils.mjs';

const rels = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pkg = 'http://schemas.openxmlformats.org/package/2006/relationships';
const draw = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const p = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const mime = 'application/vnd.openxmlformats-officedocument.presentationml';

function crc32(bytes) {
  let checksum = 0xffffffff;
  for (const byte of bytes) {
    checksum ^= byte;
    for (let i = 0; i < 8; i++) checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

function zip(entries) {
  const body = [];
  const directory = [];
  let offset = 0;
  let directoryBytes = 0;
  for (const [path, content] of Object.entries(entries)) {
    const name = Buffer.from(path);
    const bytes = Buffer.from(xml + content);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    body.push(local, name, bytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    directoryBytes += central.length + name.length;
    offset += local.length + name.length + bytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(directory.length / 2, 8);
  end.writeUInt16LE(directory.length / 2, 10);
  end.writeUInt32LE(directoryBytes, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, ...directory, end]);
}

function relationships(rows) {
  return `<Relationships xmlns="${pkg}">${rows.map(([id, kind, target, external]) => `<Relationship Id="rId${id}" Type="${rels}/${kind}" Target="${html(target)}"${external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
}

const rootAttributes = `xmlns:a="${draw}" xmlns:p="${p}" xmlns:r="${rels}"`;
const colorMapping = 'accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" bg1="lt1" bg2="lt2" folHlink="folHlink" hlink="hlink" tx1="dk1" tx2="dk2"';
const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>';
const themeColors = { dk1: '142436', lt1: 'FFFFFF', dk2: '223F55', lt2: 'F1F4F5', accent1: '12706E', accent2: '326286', accent3: '69698A', accent4: 'AE703E', accent5: '2B7950', accent6: 'B05365', hlink: '005F97', folHlink: '684897' };
const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const theme = `<a:theme xmlns:a="${draw}" name="Research Workbench"><a:themeElements><a:clrScheme name="Research Workbench">${Object.entries(themeColors).map(([key, value]) => `<a:${key}><a:srgbClr val="${value}"/></a:${key}>`).join('')}</a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Research"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${`<a:ln w="12700">${solid}</a:ln>`.repeat(3)}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

function shape(id, name, y, height, rows, size, color, bold = false) {
  const paragraphs = rows.map(({ value, link }) => `<a:p><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill>${link ? `<a:hlinkClick r:id="rId${link}"/>` : ''}</a:rPr><a:t>${html(value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')}</a:t></a:r></a:p>`).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="640000" y="${y}"/><a:ext cx="10880000" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

export function renderPptx(title, slides) {
  const contentTypes = [['/ppt/presentation.xml', 'presentation.main'], ['/ppt/slideMasters/slideMaster1.xml', 'slideMaster'], ['/ppt/slideLayouts/slideLayout1.xml', 'slideLayout'], ...slides.map((_, index) => [`/ppt/slides/slide${index + 1}.xml`, 'slide'])];
  const entries = {
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${contentTypes.map(([part, type]) => `<Override PartName="${part}" ContentType="${mime}.${type}+xml"/>`).join('')}<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`,
    '_rels/.rels': relationships([[1, 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': `<p:presentation ${rootAttributes}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': relationships([[1, 'slideMaster', 'slideMasters/slideMaster1.xml'], ...slides.map((_, index) => [index + 2, 'slide', `slides/slide${index + 1}.xml`])]),
    'ppt/slideMasters/slideMaster1.xml': `<p:sldMaster ${rootAttributes}><p:cSld><p:spTree>${group}</p:spTree></p:cSld><p:clrMap ${colorMapping}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`,
    'ppt/slideMasters/_rels/slideMaster1.xml.rels': relationships([[1, 'slideLayout', '../slideLayouts/slideLayout1.xml'], [2, 'theme', '../theme/theme1.xml']]),
    'ppt/slideLayouts/slideLayout1.xml': `<p:sldLayout ${rootAttributes} type="blank"><p:cSld name="Blank"><p:spTree>${group}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`,
    'ppt/slideLayouts/_rels/slideLayout1.xml.rels': relationships([[1, 'slideMaster', '../slideMasters/slideMaster1.xml']]),
    'ppt/theme/theme1.xml': theme,
  };
  slides.forEach((slide, index) => {
    const path = `slide${index + 1}.xml`;
    const heading = shape(2, 'Title', 410000, 900000, [{ value: slide.title }], 2800, '142436', true);
    const kicker = shape(3, 'Deck name', 1450000, 400000, [{ value: title }], 1300, '12706E');
    const body = shape(4, 'Key points', 2050000, 3200000, slide.bullets.map(value => ({ value: `• ${value}` })), 1850, '223F55');
    const sources = shape(5, 'Sources', 5510000, 1050000, slide.sources.map((source, i) => ({ value: `Source: ${source.title}`, link: i + 2 })), 1100, '005F97');
    entries[`ppt/slides/${path}`] = `<p:sld ${rootAttributes}><p:cSld><p:spTree>${group}${heading}${kicker}${body}${slide.sources.length ? sources : ''}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    entries[`ppt/slides/_rels/${path}.rels`] = relationships([[1, 'slideLayout', '../slideLayouts/slideLayout1.xml'], ...slide.sources.map((source, i) => [i + 2, 'hyperlink', source.url, true])]);
  });
  return zip(entries);
}
