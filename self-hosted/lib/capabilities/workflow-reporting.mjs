import { createHash } from 'node:crypto';
import { array, byDate, capability, cited, date, evidence, exampleLink, html, https, list, number, text, unique } from './workflow-utils.mjs';
import { renderPptx } from './workflow-pptx.mjs';

const asOf = '2026-09-30';
const sources = [{ id: 'report', title: 'Example issuer report', url: exampleLink }];

function markdownList(items) {
  return items.map(item => `- ${item}`).join('\n');
}

function validateDependencyOrder(jobs) {
  const pending = [...jobs];
  const available = new Set();
  const levels = [];
  for (const job of jobs) if (job.dependsOn.some(id => !jobs.some(other => other.id === id))) throw new Error('Unknown job dependency');
  while (pending.length) {
    const next = pending.filter(job => job.dependsOn.every(id => available.has(id)));
    if (!next.length) throw new Error('Refresh dependencies contain a cycle');
    levels.push(next.map(job => job.id));
    for (const job of next) available.add(job.id);
    for (let i = pending.length - 1; i >= 0; i--) if (available.has(pending[i].id)) pending.splice(i, 1);
  }
  return levels;
}

function downloadableHtml(title, sections) {
  const content = sections.map(section => `<section><h2>${html(section.title)}</h2><p contenteditable="plaintext-only">${html(section.body)}</p></section>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title><style>body{margin:2rem auto;max-width:54rem;padding:0 1rem;font:1rem/1.6 system-ui;color:#18334b}section{margin:1.5rem 0}p{white-space:pre-wrap;border-left:3px solid #8aadb6;padding:.75rem}</style><h1>${html(title)}</h1><button id="save" type="button">Download edited document</button><main>${content}</main><script>document.querySelector('#save').addEventListener('click',()=>{const copy=document.documentElement.cloneNode(true);copy.querySelector('#save').remove();copy.querySelector('script').remove();for(const node of copy.querySelectorAll('[contenteditable]'))node.removeAttribute('contenteditable');const url=URL.createObjectURL(new Blob(['<!doctype html>'+copy.outerHTML],{type:'text/html'}));const link=document.createElement('a');link.href=url;link.download='research-packet.html';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});</script></html>`;
}

function safeFileId(value, field) {
  const id = text(value, field, 80);
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${field} must be lowercase kebab-case`);
  return id;
}

export const reportingCapabilities = {
  'source-to-trade-data-foundation': capability('asOf: date; catalog: {id,url,date,sha256}[]; required: {id,maxAgeDays}[]', { asOf, catalog: [{ id: 'issuer', url: exampleLink, date: '2026-09-29', sha256: 'a'.repeat(64) }], required: [{ id: 'issuer', maxAgeDays: 3 }, { id: 'quotes', maxAgeDays: 1 }] }, input => {
    const asOf = date(input.asOf, 'asOf');
    const catalog = unique(array(input.catalog, 'catalog', 300, 0).map(row => {
      const digest = text(row?.sha256, 'sha256', 64).toLowerCase();
      const when = date(row?.date);
      if (!/^[0-9a-f]{64}$/.test(digest) || when > asOf) throw new Error('Catalog entry needs a valid supplied hash and a nonfuture date');
      return { id: text(row.id, 'source ID', 80), url: https(row.url), date: when, declaredSha256: digest };
    }), row => row.id, 'catalog ID');
    const required = unique(array(input.required, 'required', 100).map(row => ({ id: text(row?.id, 'required ID', 80), maxAgeDays: number(row?.maxAgeDays, 'maxAgeDays', 0, 730) })), row => row.id, 'requirement ID');
    const status = required.map(row => {
      const item = catalog.find(item => item.id === row.id);
      const ageDays = item ? (Date.parse(asOf) - Date.parse(item.date)) / 86400000 : null;
      return { id: row.id, ageDays, state: ageDays === null ? 'missing' : ageDays > row.maxAgeDays ? 'stale' : 'listed within age limit' };
    });
    return { mode: 'Supplied source catalog and refresh gap plan', asOf, catalog, status, refreshNeeded: status.filter(row => row.state !== 'listed within age limit').map(row => row.id) };
  }),
  'daily-data-refresh': capability('asOf: date; jobs: {id,dependsOn:string[],lastSuccess?:date}[]', { asOf, jobs: [{ id: 'prices', dependsOn: [], lastSuccess: '2026-09-29' }, { id: 'summary', dependsOn: ['prices'] }] }, input => {
    const asOf = date(input.asOf, 'asOf');
    const jobs = unique(array(input.jobs, 'jobs', 100).map(row => {
      const lastSuccess = row?.lastSuccess === undefined ? null : date(row.lastSuccess, 'lastSuccess');
      if (lastSuccess && lastSuccess > asOf) throw new Error('Future refresh success date');
      return { id: text(row?.id, 'job ID', 80), dependsOn: unique(list(row?.dependsOn, 'dependsOn', 80, 0), id => id, 'dependency'), lastSuccess };
    }), row => row.id, 'job ID');
    const jobMap = new Map(jobs.map(row => [row.id, row]));
    const due = new Set();
    const plan = validateDependencyOrder(jobs).map(level => level.map(id => {
      const row = jobMap.get(id);
      const prerequisites = row.dependsOn.filter(dep => due.has(dep));
      if (row.lastSuccess !== asOf || prerequisites.length) due.add(id);
      return { id, state: due.has(id) ? 'planned' : 'already recorded', prerequisites };
    }));
    return { mode: 'Dated dependency-ordered refresh plan', asOf, plan, jobsDue: due.size };
  }),
  'source-to-trade-cockpit': capability('asOf: date; artifacts: {view,title,url,date,status}[]; requiredViews: string[]', { asOf, artifacts: [{ view: 'market', title: 'Market overview', url: exampleLink, date: '2026-09-29', status: 'reviewed' }], requiredViews: ['market', 'companies'] }, input => {
    const asOf = date(input.asOf, 'asOf');
    const required = unique(list(input.requiredViews, 'requiredViews', 40), id => id, 'required view');
    const artifacts = unique(array(input.artifacts, 'artifacts', 300, 0).map(row => {
      const status = text(row?.status, 'status', 20);
      if (!['reviewed', 'preview', 'failed'].includes(status)) throw new Error('Unknown artifact status');
      return { view: text(row.view, 'view ID', 80), title: text(row.title, 'title', 220), url: https(row.url), date: date(row.date), status };
    }), row => `${row.view}\n${row.date}\n${row.status}`, 'artifact version').sort(byDate);
    const navigation = required.map(view => {
      const versions = artifacts.filter(row => row.view === view && row.date <= asOf);
      return { view, formal: versions.findLast(row => row.status === 'reviewed') ?? null, preview: versions.findLast(row => row.status === 'preview') ?? null };
    });
    return { mode: 'Reviewed artifact selection from supplied manifest', asOf, navigation, missingFormalViews: navigation.filter(row => !row.formal).map(row => row.view), html: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Research Workbench</title><h1>Research Workbench</h1><p>As of ${asOf}</p><ul>${navigation.map(row => `<li>${html(row.view)} — ${row.formal ? `<a href="${html(row.formal.url)}">${html(row.formal.title)}</a> (${row.formal.date})` : 'No reviewed artifact'}${row.preview ? ` · <a href="${html(row.preview.url)}">Preview</a>` : ''}</li>`).join('')}</ul></html>` };
  }),
  'hf-morning-brief': capability('asOf: date; measures: {name,current,previous,unit,date,sourceId}[]; events: {title,date,sourceId}[]; sources: {id,title,url}[]', { asOf, measures: [{ name: '10-year yield', current: 4.3, previous: 4.2, unit: 'percentage points', date: '2026-09-29', sourceId: 'report' }], events: [{ title: 'Issuer update', date: asOf, sourceId: 'report' }], sources }, input => {
    const asOf = date(input.asOf, 'asOf');
    const sourceList = evidence(input.sources);
    const measures = unique(array(input.measures, 'measures', 80).map(row => {
      const current = number(row?.current, 'current');
      const previous = number(row?.previous, 'previous');
      const observed = date(row?.date);
      if (observed > asOf) throw new Error('Market reading is dated after the brief');
      return { name: text(row.name, 'measure', 120), current, previous, change: current - previous, unit: text(row.unit, 'unit', 80), date: observed, sourceId: cited(row.sourceId, sourceList) };
    }), row => row.name, 'measure');
    const upcoming = array(input.events, 'events', 80, 0).map(row => ({ title: text(row?.title, 'event title', 240), date: date(row?.date), sourceId: cited(row?.sourceId, sourceList) })).filter(row => row.date >= asOf).sort(byDate);
    return { mode: 'Operator evidence pre-open brief', asOf, measures, upcoming, sources: sourceList, markdown: `# Morning brief · ${asOf}\n\n## Market readings\n${markdownList(measures.map(row => `${row.name}: ${row.current} ${row.unit}, change ${row.change.toPrecision(4)} (${row.date}) [${row.sourceId}]`))}\n\n## Calendar\n${markdownList(upcoming.map(row => `${row.date} · ${row.title} [${row.sourceId}]`))}` };
  }),
  'visiting-memo': capability('company,objective: string; visited: date; observations: {text,kind}[]; followUps: {owner,question,due}[]', { company: 'Example Issuer', objective: 'Review production', visited: asOf, observations: [{ text: 'Observed a new assembly line.', kind: 'observed' }, { text: 'Management expects higher output.', kind: 'management statement' }], followUps: [{ owner: 'Research', question: 'Confirm initial yield', due: '2026-10-10' }] }, input => {
    const company = text(input.company, 'company', 240);
    const objective = text(input.objective, 'objective', 600);
    const visited = date(input.visited, 'visited');
    const observations = array(input.observations, 'observations', 80).map(row => {
      const kind = text(row?.kind, 'observation kind', 30);
      if (!['observed', 'management statement', 'inference'].includes(kind)) throw new Error('Observation kind must be observed, management statement or inference');
      return { text: text(row.text, 'observation'), kind };
    });
    const followUps = array(input.followUps, 'followUps', 80, 0).map(row => {
      const due = date(row?.due, 'due');
      if (due < visited) throw new Error('Follow-up cannot be due before the visit');
      return { owner: text(row.owner, 'owner', 120), question: text(row.question, 'question', 400), due };
    }).sort((a, b) => a.due.localeCompare(b.due));
    return { mode: 'Company visit record', company, visited, observations, followUps, markdown: `# ${company} · ${visited}\n\n${objective}\n\n## Findings\n${markdownList(observations.map(row => `${row.kind}: ${row.text}`))}\n\n## Follow-up\n${markdownList(followUps.map(row => `${row.due} · ${row.owner} · ${row.question}`))}` };
  }),
  'ic-memo-outliner': capability('title,decision: string; thesis,risks: {text,sourceId}[]; triggers: string[]; sources: {id,title,url}[]', { title: 'Example Issuer review', decision: 'Request a second review', thesis: [{ text: 'Volumes accelerated.', sourceId: 'report' }], risks: [{ text: 'Mix may dilute margins.', sourceId: 'report' }], triggers: ['Check the next quarterly report'], sources }, input => {
    const title = text(input.title, 'title', 180);
    const decision = text(input.decision, 'decision', 600);
    const sourceList = evidence(input.sources);
    const section = (name, items) => ({ name, points: array(items, name, 50).map(row => ({ text: text(row?.text, 'point', 800), sourceId: cited(row?.sourceId, sourceList) })) });
    const sections = [section('Investment case', input.thesis), section('Risks and disconfirming evidence', input.risks)];
    const triggers = list(input.triggers, 'triggers', 20);
    return { mode: 'Source-bound committee memo outline', title, decision, sections, triggers, sources: sourceList, markdown: `# ${title}\n\n## Decision requested\n${decision}\n\n${sections.map(row => `## ${row.name}\n${markdownList(row.points.map(point => `${point.text} [${point.sourceId}]`))}`).join('\n\n')}\n\n## Next review triggers\n${markdownList(triggers)}` };
  }),
  'ic-pptx-renderer': capability('title: string; slides: {title,bullets:string[],sourceIds:string[]}[]; sources: {id,title,url}[]', { title: 'Example issuer review', slides: [{ title: 'Operating overview', bullets: ['Shipments increased in the third quarter.', 'Check product mix in the next report.'], sourceIds: ['report'] }], sources }, input => {
    const title = text(input.title, 'title', 80);
    const sourceList = evidence(input.sources);
    const slides = array(input.slides, 'slides', 20).map(row => ({ title: text(row?.title, 'slide title', 75), bullets: array(row?.bullets, 'bullets', 5).map(point => text(point, 'bullet', 120)), sources: unique(list(row?.sourceIds, 'sourceIds', 3, 0), id => id, 'slide source').map(id => sourceList.find(source => source.id === cited(id, sourceList))) }));
    const data = renderPptx(title, slides);
    return { mode: 'Editable Open XML PowerPoint draft', filename: 'investment-committee-draft.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', encoding: 'base64', slideCount: slides.length, base64: data.toString('base64') };
  }),
  'gemini-imagegen': capability('brief,audience,style: string; aspectRatio: 1:1|4:3|16:9; approvedImage?: {mimeType,base64}', { brief: 'Illustrate evidence moving from collection through review to the workbench.', audience: 'Investment researchers', style: 'Editorial technical diagram', aspectRatio: '16:9' }, input => {
    const brief = text(input.brief, 'brief', 900);
    const audience = text(input.audience, 'audience', 160);
    const style = text(input.style, 'style', 160);
    const aspectRatio = text(input.aspectRatio, 'aspectRatio', 4);
    if (!['1:1', '4:3', '16:9'].includes(aspectRatio)) throw new Error('Unsupported aspect ratio');
    const prompt = `Create an illustration for ${audience}. Subject: ${brief} Style: ${style}. Aspect ratio: ${aspectRatio}. Leave room for a separate report caption.`;
    if (input.approvedImage === undefined) return { mode: 'Illustration generation handoff', prompt, aspectRatio };
    const mimeType = text(input.approvedImage?.mimeType, 'mimeType', 20);
    const encoded = text(input.approvedImage?.base64, 'base64', 500000);
    if (!['image/png', 'image/jpeg'].includes(mimeType) || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Use a base64 PNG or JPEG');
    const bytes = Buffer.from(encoded, 'base64');
    const png = bytes.length >= 33 && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' && bytes.subarray(12, 16).toString() === 'IHDR';
    const jpeg = bytes.length >= 12 && bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && bytes.subarray(-2).toString('hex') === 'ffd9';
    if (bytes.toString('base64') !== encoded || (mimeType === 'image/png' ? !png : !jpeg)) throw new Error('Image bytes do not match the declared format');
    return { mode: 'Approved image import', prompt, image: { mimeType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: encoded } };
  }),
  'pptx-template-analyzer': capability('width,height: positive numbers; slides: {name,shapes:{role,x,y,width,height}[]}[] (same geometry unit)', { width: 1280, height: 720, slides: [{ name: 'Two-column', shapes: [{ role: 'title', x: 40, y: 30, width: 1200, height: 80 }, { role: 'content', x: 40, y: 150, width: 560, height: 470 }] }] }, input => {
    const width = number(input.width, 'width', Number.MIN_VALUE);
    const height = number(input.height, 'height', Number.MIN_VALUE);
    const layouts = unique(array(input.slides, 'slides', 60).map(row => {
      const name = text(row?.name, 'layout name', 140);
      const shapes = array(row.shapes, 'shapes', 80, 0).map(shape => {
        const role = text(shape?.role, 'shape role', 80);
        const x = number(shape?.x, 'x');
        const y = number(shape?.y, 'y');
        const boxWidth = number(shape?.width, 'shape width', Number.MIN_VALUE);
        const boxHeight = number(shape?.height, 'shape height', Number.MIN_VALUE);
        return { role, x, y, width: boxWidth, height: boxHeight, outOfBounds: x < 0 || y < 0 || x + boxWidth > width || y + boxHeight > height };
      });
      return { name, shapes, roleCounts: Object.entries(Object.groupBy(shapes, shape => shape.role)).map(([role, rows]) => ({ role, count: rows.length })), outOfBounds: shapes.filter(shape => shape.outOfBounds).length };
    }), row => row.name, 'layout name');
    return { mode: 'Extracted slide geometry review', aspectRatio: width / height, width, height, layouts };
  }),
  'html5-editor': capability('title: string; sections: {title,body}[]', { title: 'Research packet', sections: [{ title: 'Overview', body: 'Review the operating evidence.' }] }, input => {
    const title = text(input.title, 'title', 240);
    const sections = array(input.sections, 'sections', 30).map(row => ({ title: text(row?.title, 'section title', 240), body: text(row?.body, 'section body', 10000) }));
    return { mode: 'Editable HTML research packet', filename: 'research-packet-editor.html', sections: sections.length, html: downloadableHtml(title, sections) };
  }),
  'skill-creator': capability('id: kebab-case string; purpose: string; steps: string[]; cases: {input,expected}[]', { id: 'check-operating-update', purpose: 'Check the dates and measures in an issuer update.', steps: ['Identify the issuer and reporting period.', 'Compare reported measures with the prior period.'], cases: [{ input: 'Issuer statement lacks a reporting period.', expected: 'Request a dated source.' }] }, input => {
    const id = safeFileId(input.id, 'skill ID');
    const purpose = text(input.purpose, 'purpose', 500).replace(/\s+/g, ' ');
    const steps = list(input.steps, 'steps', 30);
    const cases = unique(array(input.cases, 'cases', 30).map(row => ({ input: text(row?.input, 'evaluation input'), expected: text(row?.expected, 'expected output') })), row => row.input, 'evaluation input');
    return { mode: 'Portable workflow skill and evaluation draft', id, files: [{ filename: 'SKILL.md', content: `---\nname: ${id}\ndescription: ${JSON.stringify(purpose)}\n---\n\n# ${id}\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}\n` }, { filename: 'evaluation-cases.json', content: JSON.stringify(cases, null, 2) + '\n' }] };
  }),
};
