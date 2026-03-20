import { useState } from 'react';
import { Download, FileText, FileJson, Loader2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import type { TaskBibleEntry } from '../../types';

interface Props {
  entry?: TaskBibleEntry;
  projectName?: string;
}

export function ExportControls({ entry, projectName }: Props) {
  const [exporting, setExporting] = useState<string | null>(null);

  if (!entry) return null;

  function exportMarkdown() {
    setExporting('md');
    try {
      const parts: string[] = [];
      parts.push(`# ${entry!.title}\n\n`);
      parts.push(`**Task:** ${entry!.task_number}\n`);
      parts.push(`**Project:** ${projectName ?? 'Unknown'}\n`);
      parts.push(`**Finalized:** ${entry!.timestamps.finalized_at ?? 'In progress'}\n\n`);

      parts.push(`## Final Output\n\n${entry!.final_output}\n\n`);

      if (entry!.code_blocks.length > 0) {
        parts.push(`## Code Blocks\n\n`);
        for (const b of entry!.code_blocks) {
          parts.push(`### ${b.filename} (${b.language})\n\n`);
          parts.push('```' + b.language + '\n' + b.content + '\n```\n\n');
        }
      }

      parts.push(`## Signature\n\n`);
      parts.push(`TL-DSA: \`${entry!.tl_dsa_signature}\`\n\n`);

      if (entry!.signature_chain.length > 0) {
        parts.push(`### Integrity Chain\n\n`);
        for (const s of entry!.signature_chain) {
          parts.push(`- Step ${s.step}: \`${s.hash}\` (${s.timestamp})\n`);
        }
      }

      const blob = new Blob([parts.join('')], { type: 'text/markdown;charset=utf-8' });
      downloadBlob(blob, `${entry!.task_number}-${slugify(entry!.title)}.md`);
    } finally {
      setExporting(null);
    }
  }

  function exportPDF() {
    setExporting('pdf');
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const margin = 15;
      const pageW = doc.internal.pageSize.getWidth() - margin * 2;
      let y = margin;

      // Helper: auto-paginate
      function checkPage(need: number) {
        if (y + need > doc.internal.pageSize.getHeight() - margin) {
          doc.addPage();
          y = margin;
        }
      }

      // Title
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text(entry!.title, margin, y);
      y += 8;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Task: ${entry!.task_number}  |  Project: ${projectName ?? ''}  |  Finalized: ${entry!.timestamps.finalized_at ?? 'N/A'}`, margin, y);
      y += 6;

      doc.setTextColor(0);
      doc.setDrawColor(200);
      doc.line(margin, y, margin + pageW, y);
      y += 6;

      // Final Output
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Final Output', margin, y);
      y += 5;

      doc.setFont('courier', 'normal');
      doc.setFontSize(8);
      const outputLines = doc.splitTextToSize(entry!.final_output, pageW);
      for (const line of outputLines) {
        checkPage(4);
        doc.text(line, margin, y);
        y += 3.5;
      }
      y += 4;

      // Code Blocks
      if (entry!.code_blocks.length > 0) {
        checkPage(10);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(11);
        doc.text('Code Blocks', margin, y);
        y += 5;

        for (const block of entry!.code_blocks) {
          checkPage(8);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.text(`${block.filename} (${block.language}, ${block.line_count} lines)`, margin, y);
          y += 4;

          doc.setFont('courier', 'normal');
          doc.setFontSize(7);
          const codeLines = doc.splitTextToSize(block.content, pageW);
          for (const line of codeLines) {
            checkPage(3.5);
            doc.text(line, margin, y);
            y += 3;
          }
          y += 4;
        }
      }

      // Signature
      checkPage(15);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Cryptographic Signature', margin, y);
      y += 5;

      doc.setFont('courier', 'normal');
      doc.setFontSize(7);
      doc.text(`TL-DSA: ${entry!.tl_dsa_signature}`, margin, y);
      y += 4;

      for (const s of entry!.signature_chain) {
        checkPage(4);
        doc.text(`Step ${s.step}: ${s.hash} (${s.timestamp})`, margin, y);
        y += 3.5;
      }

      // Footer
      const pageCount = doc.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(
          `YODA — Capomastro Holdings Ltd. — Page ${i}/${pageCount}`,
          margin,
          doc.internal.pageSize.getHeight() - 8,
        );
      }

      doc.save(`${entry!.task_number}-${slugify(entry!.title)}.pdf`);
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={exportMarkdown}
        disabled={exporting !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] disabled:opacity-50 transition-colors"
      >
        {exporting === 'md' ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
        Markdown
      </button>
      <button
        onClick={exportPDF}
        disabled={exporting !== null}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-[var(--color-surface-tertiary)] text-[var(--color-text-secondary)] border border-[var(--color-border-default)] hover:border-[var(--color-border-strong)] disabled:opacity-50 transition-colors"
      >
        {exporting === 'pdf' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
        PDF
      </button>
    </div>
  );
}

/* ── Helpers ── */

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
