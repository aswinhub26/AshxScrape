/**
 * AshxScrape Export Engine
 * Implements RFC 4180 CSV, TSV (for Sheets/Excel clipboard), and CSV Injection Guards.
 */

import { FIELD_DEFINITIONS } from './schema.js';

/**
 * Sanitizes a field against CSV formula injection (DDE attacks).
 * If a value starts with =, +, -, @, \t, \r, prepend a single quote.
 */
export function sanitizeCsvValue(val) {
  if (val === null || val === undefined) return '';
  let str = String(val);

  // CSV Formula Injection Guard
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  // RFC 4180 Quoting: If string contains comma, double-quote, or newline, wrap in quotes and escape quotes as ""
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Generates RFC 4180 compliant CSV string with UTF-8 BOM.
 */
export function generateCsv(rows, columns = null) {
  const fields = columns || FIELD_DEFINITIONS.map(f => f.key);
  const headerLabels = fields.map(k => {
    const def = FIELD_DEFINITIONS.find(f => f.key === k);
    return def ? def.label : k;
  });

  const headerLine = headerLabels.map(sanitizeCsvValue).join(',');

  const lines = [headerLine];
  for (const row of rows) {
    const line = fields.map(k => sanitizeCsvValue(row[k])).join(',');
    lines.push(line);
  }

  // UTF-8 BOM (\uFEFF) ensures Excel properly decodes Unicode / non-ASCII (e.g. Tamil, Cyrillic, Accents)
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Generates TSV (Tab-Separated Values) for direct clipboard paste into Google Sheets / Excel.
 */
export function generateTsv(rows, columns = null) {
  const fields = columns || FIELD_DEFINITIONS.map(f => f.key);
  const headerLabels = fields.map(k => {
    const def = FIELD_DEFINITIONS.find(f => f.key === k);
    return def ? def.label : k;
  });

  const lines = [headerLabels.join('\t')];
  for (const row of rows) {
    const line = fields.map(k => {
      const val = row[k];
      if (val === null || val === undefined) return '';
      // Replace tabs and newlines inside cell for TSV
      return String(val).replace(/\t/g, ' ').replace(/[\r\n]+/g, ' ');
    }).join('\t');
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Generates XLSX binary using SheetJS (bundled via npm).
 * Returns an ArrayBuffer suitable for Blob download.
 */
export async function generateXlsx(rows, query = 'AshxScrape Export') {
  // Dynamically import xlsx (SheetJS) — bundled by Vite
  const XLSX = await import('xlsx');

  const fields = FIELD_DEFINITIONS.map(f => f.key);
  const headerLabels = FIELD_DEFINITIONS.map(f => f.label);

  // Build worksheet data array: first row = headers
  const wsData = [headerLabels];
  for (const row of rows) {
    wsData.push(fields.map(k => {
      const val = row[k];
      if (val === null || val === undefined) return '';
      return val;
    }));
  }

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Auto column widths (approximate)
  ws['!cols'] = headerLabels.map((h, i) => {
    const maxLen = rows.reduce((acc, row) => {
      const v = String(row[fields[i]] ?? '');
      return Math.max(acc, v.length);
    }, h.length);
    return { wch: Math.min(maxLen + 2, 50) };
  });

  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');

  // Add metadata sheet
  const metaData = [
    ['AshxScrape Export'],
    ['Query', query],
    ['Total Records', rows.length],
    ['Exported At', new Date().toISOString()],
    ['Extension', 'AshxScrape MV3']
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(metaData);
  XLSX.utils.book_append_sheet(wb, wsMeta, 'Info');

  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

/**
 * Generates structured JSON export with metadata envelope.
 */
export function generateJson(rows, query = '', jobId = null) {
  const fields = FIELD_DEFINITIONS.map(f => f.key);
  const cleanRows = rows.map(row => {
    const obj = {};
    for (const k of fields) {
      const val = row[k];
      obj[k] = (val === null || val === undefined) ? null : val;
    }
    return obj;
  });

  const envelope = {
    meta: {
      tool: 'AshxScrape',
      version: '1.0.0',
      query: query || null,
      jobId: jobId || null,
      exportedAt: new Date().toISOString(),
      totalRecords: cleanRows.length,
      fields: FIELD_DEFINITIONS.map(f => ({ key: f.key, label: f.label, source: f.source }))
    },
    data: cleanRows
  };

  return JSON.stringify(envelope, null, 2);
}

/**
 * Creates a slugified timestamped filename: ASHXSCRAPE_<slug>_<YYYY-MM-DD_HHmm>.<ext>
 */
export function generateFilename(query, ext = 'csv') {
  const slug = (query || 'leads')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const mins = String(now.getMinutes()).padStart(2, '0');

  const timestamp = `${year}-${month}-${day}_${hours}${mins}`;
  return `ASHXSCRAPE_${slug}_${timestamp}.${ext}`;
}

/**
 * Triggers file download via Blob URL
 */
export async function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    try {
      await chrome.downloads.download({
        url,
        filename,
        saveAs: true
      });
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      return;
    } catch (e) {
      // Fallback to DOM anchor click
    }
  }

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

