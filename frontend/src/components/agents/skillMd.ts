/* ═══════════════════════════════════════════════════════════════
   SKILL.md serializer — Agent Roster export
   Builds a SKILL.md string from the Agent Editor form values,
   matching the structure of files in `.agents/skills/<agent>/SKILL.md`.
   ═══════════════════════════════════════════════════════════════ */

import type { AgentDivision } from '../../types';
import { DIVISIONS } from '../../types/agent';

export interface AgentSkillMdInput {
  displayName: string;
  division: AgentDivision;
  primaryRole: 'Producer' | 'Reviewer' | 'Both';
  about: string;
  keySkills: string[];
  competencies: string[];
  reviewCriteria: string[];
  compatibleReviewers: string[];
  agentId?: string;
}

/** Lowercase hyphenated slug derived from a display name. */
export function slugifyAgentName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'agent'
  );
}

/** The download filename for an agent's SKILL.md export. */
export function agentMdFilename(input: AgentSkillMdInput): string {
  const base = input.agentId?.trim() || slugifyAgentName(input.displayName);
  return `${base}.md`;
}

/** Quote a YAML scalar only when it contains characters that need it. */
function yamlScalar(value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  if (v === '') return '""';
  const startsBad = /^[-?:,[\]{}#&*!|>'"%@`]/.test(v);
  const hasFlow = /:\s/.test(v) || /\s#/.test(v) || /:$/.test(v);
  if (startsBad || hasFlow) {
    return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return v;
}

/** Derive a single-line description from the (possibly multi-paragraph) about text. */
function deriveDescription(about: string): string {
  const oneLine = about.replace(/\s+/g, ' ').trim();
  const sentence = oneLine.match(/^(.*?\.)(\s|$)/);
  return sentence ? sentence[1] : oneLine;
}

function bulletList(items: string[]): string {
  const clean = items.map(i => i.trim()).filter(Boolean);
  if (clean.length === 0) return '_None specified._';
  return clean.map(i => `- ${i}`).join('\n');
}

/**
 * Build a SKILL.md string from the current Agent Editor form values.
 * Pure — no DOM or clipboard side effects.
 */
export function buildAgentSkillMd(input: AgentSkillMdInput): string {
  const name = slugifyAgentName(input.displayName);
  const divMeta = DIVISIONS.find(d => d.id === input.division);
  const divisionLabel = divMeta?.label ?? input.division;
  const description = deriveDescription(input.about);
  const competencies = input.competencies.map(c => c.trim()).filter(Boolean);

  const lines: string[] = [
    '---',
    `name: ${yamlScalar(name)}`,
    `description: ${yamlScalar(description)}`,
    '---',
    '',
    `# ${input.displayName.trim()}`,
    '',
    `**Division:** ${divisionLabel}`,
    `**YODA Role ID:** \`${input.division}/${name}\``,
    `**Primary role:** ${input.primaryRole}`,
    '',
    '## Identity',
    '',
    input.about.trim() || '_None specified._',
    '',
    '## Key skills',
    '',
    bulletList(input.keySkills),
    '',
    '## Competencies',
    '',
    competencies.length > 0 ? competencies.join(', ') : '_None specified._',
    '',
    '## Review criteria',
    '',
    bulletList(input.reviewCriteria),
    '',
    '## Compatible reviewers',
    '',
    bulletList(input.compatibleReviewers),
    '',
  ];

  return lines.join('\n');
}
