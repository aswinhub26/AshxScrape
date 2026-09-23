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
 * Generates an executive lead analytics summary (Markdown format)
 * Perfect for sharing campaign stats into Slack, Notion, or client reports.
 */
export function generateLeadSummary(rows, query = 'Leads') {
  if (!rows || rows.length === 0) return '# Lead Campaign Summary\n\nNo records available.';

  const total = rows.length;
  const withPhone = rows.filter(r => r.phone).length;
  const withWebsite = rows.filter(r => r.website).length;
  const withoutWebsite = total - withWebsite;
  const withEmail = rows.filter(r => r.email).length;
  const withInstagram = rows.filter(r => r.instagram).length;
  const withFacebook = rows.filter(r => r.facebook).length;
  const withLinkedin = rows.filter(r => r.linkedin).length;

  const validRatings = rows.filter(r => typeof r.rating === 'number' && !isNaN(r.rating) && r.rating > 0);
  const avgRating = validRatings.length > 0
    ? (validRatings.reduce((sum, r) => sum + r.rating, 0) / validRatings.length).toFixed(2)
    : 'N/A';

  const totalReviews = rows.reduce((sum, r) => sum + (parseInt(r.reviewCount, 10) || 0), 0);

  // Category breakdown
  const categoryMap = {};
  for (const r of rows) {
    if (r.category) {
      categoryMap[r.category] = (categoryMap[r.category] || 0) + 1;
    }
  }
  const topCategories = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([cat, count]) => `- ${cat}: ${count} places (${Math.round((count / total) * 100)}%)`)
    .join('\n');

  return [
    `# 📊 AshxScrape Lead Analytics — "${query}"`,
    `Generated on ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`,
    ``,
    `### 📈 Key Metrics`,
    `- **Total Verified Leads:** ${total}`,
    `- **Phone Coverage:** ${withPhone} / ${total} (${Math.round((withPhone / total) * 100)}%)`,
    `- **Web Presence:** ${withWebsite} / ${total} (${Math.round((withWebsite / total) * 100)}%)`,
    `- **🔥 No-Website Opportunities:** ${withoutWebsite} (${Math.round((withoutWebsite / total) * 100)}%)`,
    `- **📧 Email Contacts:** ${withEmail} / ${total} (${Math.round((withEmail / total) * 100)}%)`,
    `- **📱 Social Media Leads:** ${withInstagram} Instagram, ${withFacebook} Facebook, ${withLinkedin} LinkedIn`,
    `- **Average Rating:** ★ ${avgRating} (from ${totalReviews.toLocaleString()} total reviews)`,
    ``,
    `### 🏷️ Top Business Categories`,
    topCategories || '- No category data available',
    ``,
    `---`,
    `*Extracted locally via AshxScrape Chrome Extension*`
  ].join('\n');
}

/**
 * Converts a Blob to a Base64 data URL for rock-solid downloads in Chrome side panels
 */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Triggers reliable file download across Chrome MV3 Side Panel & web contexts.
 */
export async function downloadFile(content, filename, mimeType = 'text/csv;charset=utf-8') {
  const blobParts = (content instanceof Uint8Array || content instanceof ArrayBuffer) ? [content] : [content];
  const blob = new Blob(blobParts, { type: mimeType });
  const dataUrl = await blobToDataUrl(blob);

  // 1. Try Chrome Downloads API with Data URL (works without blob isolation issues)
  if (typeof chrome !== 'undefined' && chrome.downloads?.download) {
    try {
      await chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: false
      });
      return true;
    } catch (e) {
      console.warn('[AshxScrape Export] chrome.downloads fallback to DOM click:', e.message);
    }
  }

  // 2. Direct HTML5 Anchor Click fallback
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
  }, 1000);

  return true;
}




