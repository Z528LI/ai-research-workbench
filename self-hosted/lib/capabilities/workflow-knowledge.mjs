import { createHash } from 'node:crypto';
import { array, capability, cited, date, evidence, exampleLink, list, number, text, unique } from './workflow-utils.mjs';

const sources = [{ id: 'report', title: 'Example issuer report', url: exampleLink }];
const finding = { statement: 'The issuer reported higher shipments.', sourceId: 'report', kind: 'fact' };
const sampleQuestion = 'What drove shipment growth?';

function findings(input, sourceList) {
  return array(input, 'findings', 100).map(row => {
    const kind = text(row?.kind, 'kind', 30);
    if (!['fact', 'inference'].includes(kind)) throw new Error('Finding kind must be fact or inference');
    return { statement: text(row.statement, 'statement'), sourceId: cited(row.sourceId, sourceList), kind };
  });
}

function sourceMarkdown(sourceList) {
  return sourceList.map(row => `- ${row.id}: ${row.title} — ${row.url}`).join('\n');
}

export const knowledgeCapabilities = {
  'gemini-router': capability('question: string; dimensions: string[]; sources: {id,title,url}[]', { question: sampleQuestion, dimensions: ['Pricing', 'Volume'], sources }, input => {
    const question = text(input.question, 'question', 500);
    const sourceList = evidence(input.sources);
    const dimensions = unique(list(input.dimensions, 'dimensions', 12), item => item.toLowerCase(), 'research dimension');
    const tasks = dimensions.map((dimension, index) => ({ id: `research-${index + 1}`, dimension, prompt: `Research this dimension: ${dimension}. Answer: ${question}\nUse the assigned sources and mark inferences and unresolved claims.`, sources: sourceList.map(row => row.id), state: 'awaiting operator research' }));
    return { mode: 'Local parallel research handoff', question, tasks, synthesisDependsOn: tasks.map(task => task.id), sources: sourceList };
  }),
  'gemini-deep-research-router': capability('jobs: {id,question,status,asOf,output?,sourceIds?}[]; sources: {id,title,url}[]', { jobs: [{ id: 'growth', question: sampleQuestion, status: 'completed', asOf: '2026-09-29', output: 'Shipment growth came from volume.', sourceIds: ['report'] }, { id: 'margin', question: 'What happened to margins?', status: 'pending', asOf: '2026-09-29' }], sources }, input => {
    const sourceList = evidence(input.sources);
    const jobs = unique(array(input.jobs, 'jobs', 100).map(row => {
      const id = text(row?.id, 'job ID', 80);
      const question = text(row.question, 'question', 500);
      const asOf = date(row.asOf, 'asOf');
      const status = text(row.status, 'status', 20);
      if (!['pending', 'running', 'failed', 'completed'].includes(status)) throw new Error('Unsupported research status');
      const result = status === 'completed' ? { output: text(row.output, 'completed job output', 12000), sourceIds: [...new Set(list(row.sourceIds, 'sourceIds').map(id => cited(id, sourceList)))] } : null;
      return { id, question, asOf, status, result };
    }), row => row.id, 'job ID');
    return { mode: 'Operator research-job register', jobs, readyForSynthesis: jobs.filter(job => job.result), unresolved: jobs.filter(job => !job.result).map(job => job.id), sources: sourceList };
  }),
  'target-user-research': capability('interviews: {id,segment,excerpt,themes:string[]}[]', { interviews: [{ id: 'demo-1', segment: 'researcher', excerpt: 'I need a stable link to the evidence.', themes: ['source traceability'] }, { id: 'demo-2', segment: 'researcher', excerpt: 'I export reports to share them.', themes: ['sharing', 'source traceability'] }] }, input => {
    const interviews = unique(array(input.interviews, 'interviews', 200).map(row => ({ id: text(row?.id, 'interview ID', 80), segment: text(row?.segment, 'segment', 120), excerpt: text(row?.excerpt, 'excerpt', 2000), themes: [...new Set(list(row?.themes, 'themes', 20).map(theme => theme.toLowerCase()))] })), row => row.id, 'interview ID');
    const themes = [...new Set(interviews.flatMap(row => row.themes))].map(theme => {
      const mentions = interviews.filter(row => row.themes.includes(theme));
      return { theme, interviewCount: mentions.length, shareOfSample: mentions.length / interviews.length, segments: [...new Set(mentions.map(row => row.segment))], supportingExcerpts: mentions.slice(0, 3).map(({ id, excerpt }) => ({ id, excerpt })) };
    }).sort((a, b) => b.interviewCount - a.interviewCount || a.theme.localeCompare(b.theme));
    return { mode: 'Coded interview synthesis', sampleSize: interviews.length, themes };
  }),
  'serious-answer': capability('question,answer: string; findings: {statement,kind,sourceId}[]; openQuestions: string[]; sources: {id,title,url}[]', { question: sampleQuestion, answer: 'The report identifies rising shipments.', findings: [finding], openQuestions: ['How much came from a new contract?'], sources }, input => {
    const question = text(input.question, 'question', 500);
    const answer = text(input.answer, 'answer');
    const sourceList = evidence(input.sources);
    const rows = findings(input.findings, sourceList);
    return { mode: 'Cited answer review', question, answer, facts: rows.filter(row => row.kind === 'fact'), inferences: rows.filter(row => row.kind === 'inference'), openQuestions: list(input.openQuestions, 'openQuestions', 30, 0), sources: sourceList };
  }),
  'deep-research-workflow': capability('topic: string; findings: {statement,kind,sourceId}[]; checks: {question,status}[]; sources: {id,title,url}[]', { topic: 'Shipments', findings: [finding], checks: [{ question: 'Does the filing identify shipments?', status: 'passed' }, { question: 'Can prior-year comparisons be reproduced?', status: 'open' }], sources }, input => {
    const topic = text(input.topic, 'topic', 300);
    const sourceList = evidence(input.sources);
    const claims = findings(input.findings, sourceList);
    const checks = unique(array(input.checks, 'checks', 50).map(row => {
      const status = text(row?.status, 'status', 15);
      if (!['passed', 'failed', 'open'].includes(status)) throw new Error('Check status must be passed, failed or open');
      return { question: text(row.question, 'check question', 400), status };
    }), row => row.question, 'quality check');
    const checksOutstanding = checks.filter(row => row.status !== 'passed');
    return { mode: 'Research brief with review checks', topic, status: checksOutstanding.length ? 'needs review' : 'checks passed', checks, sources: sourceList, markdown: `# ${topic}\n\n${claims.map(row => `- ${row.kind}: ${row.statement} [${row.sourceId}]`).join('\n')}\n\n## Checks\n${checks.map(row => `- ${row.question} — ${row.status}`).join('\n')}\n\n## Sources\n${sourceMarkdown(sourceList)}\n` };
  }),
  'notebooklm-router-py': capability('notebook: string; sources: {id,title,url}[]; questions: string[]; transcript: {sourceId,offsetSeconds,text}[]; query: string', { notebook: 'Issuer evidence', sources, questions: [sampleQuestion], transcript: [{ sourceId: 'report', offsetSeconds: 20, text: 'Growth came from shipment volume.' }], query: 'volume' }, input => {
    const sourceList = evidence(input.sources);
    const query = text(input.query, 'query', 180).toLowerCase();
    const transcript = array(input.transcript, 'transcript', 500, 0).map(row => ({ sourceId: cited(row?.sourceId, sourceList), offsetSeconds: number(row?.offsetSeconds, 'offsetSeconds', 0), text: text(row?.text, 'transcript text') }));
    return { mode: 'Local notebook import and transcript search', notebook: text(input.notebook, 'notebook', 200), importUrls: sourceList.map(row => row.url), questionBatch: list(input.questions, 'questions', 50), matches: transcript.filter(row => row.text.toLowerCase().includes(query)).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.offsetSeconds - b.offsetSeconds), sources: sourceList };
  }),
  'onenote-nlm-sync': capability('notes: {id,title,body,modified}[]; destination: {id,digest}[]', { notes: [{ id: 'demo-note', title: 'Quarterly review', body: 'Review filing and update memo.', modified: '2026-09-29' }], destination: [] }, input => {
    const existing = new Map(unique(array(input.destination, 'destination', 500, 0).map(row => {
      const digest = text(row?.digest, 'digest', 64).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('Destination digest must be a SHA-256 hex string');
      return { id: text(row.id, 'note ID', 80), digest };
    }), row => row.id, 'destination note ID').map(row => [row.id, row.digest]));
    const notes = unique(array(input.notes, 'notes', 100).map(row => ({ id: text(row?.id, 'note ID', 80), title: text(row?.title, 'title', 240), body: text(row?.body, 'body', 12000), modified: date(row?.modified, 'modified') })), row => row.id, 'source note ID');
    const handoffs = notes.map(note => {
      const digest = createHash('sha256').update(JSON.stringify([note.title, note.body])).digest('hex');
      const prior = existing.get(note.id);
      const action = prior === digest ? 'unchanged' : prior ? 'update' : 'create';
      return { id: note.id, modified: note.modified, digest, action, markdown: action === 'unchanged' ? null : `# ${note.title}\n\n${note.body}\n` };
    });
    return { mode: 'Offline note sync plan', handoffs, destinationOnly: [...existing.keys()].filter(id => !notes.some(note => note.id === id)) };
  }),
  'onenote-quick-research': capability('title: string; notes: string[]; claims: {metric,value,crossCheck,tolerance,sourceId}[]; sources: {id,title,url}[]', { title: 'Volume quick check', notes: ['Use the reported figure.'], claims: [{ metric: 'Shipments', value: 105, crossCheck: 104.9, tolerance: 0.2, sourceId: 'report' }], sources }, input => {
    const title = text(input.title, 'title', 240);
    const sourceList = evidence(input.sources);
    const notes = list(input.notes, 'notes', 30);
    const crossChecks = array(input.claims, 'claims', 100).map(row => {
      const value = number(row?.value, 'value');
      const crossCheck = number(row?.crossCheck, 'crossCheck');
      const tolerance = number(row?.tolerance, 'tolerance', 0);
      const difference = value - crossCheck;
      return { metric: text(row.metric, 'metric', 180), value, crossCheck, difference, tolerance, withinTolerance: Math.abs(difference) <= tolerance, sourceId: cited(row.sourceId, sourceList) };
    });
    return { mode: 'Portable research note', title, crossChecks, sources: sourceList, markdown: `# ${title}\n\n${notes.map(note => `- ${note}`).join('\n')}\n\n## Numeric checks\n${crossChecks.map(row => `- ${row.metric}: ${row.value} vs ${row.crossCheck} [${row.sourceId}] — ${row.withinTolerance ? 'within tolerance' : 'review'}`).join('\n')}\n\n## Sources\n${sourceMarkdown(sourceList)}\n` };
  }),
  'research-wiki-builder': capability('pages: {id,title,body,related:string[],sourceIds:string[]}[]; sources: {id,title,url}[]', { pages: [{ id: 'shipments', title: 'Shipments', body: 'Reported volumes are reviewed quarterly.', related: ['evidence'], sourceIds: ['report'] }, { id: 'evidence', title: 'Evidence', body: 'The quarterly issuer report.', related: [], sourceIds: ['report'] }], sources }, input => {
    const sourceList = evidence(input.sources);
    const pages = unique(array(input.pages, 'pages', 60).map(row => {
      const id = text(row?.id, 'page ID', 60);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Use a lowercase kebab-case wiki ID');
      return { id, title: text(row.title, 'title', 240), body: text(row.body, 'body', 10000), related: [...new Set(list(row.related, 'related', 30, 0))], sourceIds: [...new Set(list(row.sourceIds, 'sourceIds', 30).map(id => cited(id, sourceList)))] };
    }), row => row.id, 'wiki page ID');
    for (const page of pages) if (page.related.some(id => id === page.id || !pages.some(other => other.id === id))) throw new Error('Wiki relationship has a missing or self-referencing page');
    return { mode: 'Local wiki render', index: pages.map(row => ({ title: row.title, filename: `${row.id}.md` })), pages: pages.map(page => {
      const backlinks = pages.filter(other => other.related.includes(page.id)).map(other => other.id);
      const links = [...new Set([...page.related, ...backlinks])].map(id => `- [${id}](${id}.md)`);
      return { id: page.id, backlinks, filename: `${page.id}.md`, markdown: `# ${page.title}\n\n${page.body}\n\n## Related pages\n${links.join('\n')}\n\n## Sources\n${sourceMarkdown(sourceList.filter(source => page.sourceIds.includes(source.id)))}\n` };
    }) };
  }),
};
