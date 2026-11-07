import { knowledgeCapabilities } from './workflow-knowledge.mjs';
import { reportingCapabilities } from './workflow-reporting.mjs';
import { sourceCapabilities } from './workflow-sources.mjs';

export const workflowCapabilities = { ...sourceCapabilities, ...knowledgeCapabilities, ...reportingCapabilities };
