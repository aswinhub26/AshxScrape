/**
 * Virtualized Data Table Component
 * High-performance DOM virtualization keeping memory minimal and rendering buttery-smooth at 5000+ rows.
 */

const ROW_HEIGHT = 32; // px per row
const BUFFER_COUNT = 8; // Extra buffer rows rendered outside visible viewport

export class VirtualTable {
  constructor(containerEl, options = {}) {
    this.container = containerEl;
    this.rows = [];
    this.sortKey = null;
    this.sortAsc = true;
    this.onRowClick = options.onRowClick || (() => {});

    this.table = null;
    this.tbody = null;
    this.spacerTop = null;
    this.spacerBottom = null;

    this.initDOM();
  }

  initDOM() {
    this.container.innerHTML = `
      <table class="data-table" id="virtualDataTable">
        <thead>
          <tr>
            <th data-sort="index" style="width: 32px; cursor: pointer;">#</th>
            <th data-sort="name" style="width: 140px; cursor: pointer;">Name <span class="sort-icon"></span></th>
            <th data-sort="rating" style="width: 55px; cursor: pointer;">Rating <span class="sort-icon"></span></th>
            <th data-sort="reviewCount" style="width: 60px; cursor: pointer;">Reviews <span class="sort-icon"></span></th>
            <th data-sort="category" style="width: 90px; cursor: pointer;">Category <span class="sort-icon"></span></th>
            <th data-sort="phone" style="width: 100px; cursor: pointer;">Phone <span class="sort-icon"></span></th>
            <th data-sort="domain" style="width: 110px; cursor: pointer;">Website <span class="sort-icon"></span></th>
            <th data-sort="address" style="width: 140px; cursor: pointer;">Address <span class="sort-icon"></span></th>
          </tr>
        </thead>
        <tbody id="virtualTbody"></tbody>
      </table>
    `;

    this.table = this.container.querySelector('#virtualDataTable');
    this.tbody = this.container.querySelector('#virtualTbody');

    // Header sort click listeners
    const ths = this.table.querySelectorAll('th[data-sort]');
    ths.forEach(th => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (this.sortKey === key) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortKey = key;
          this.sortAsc = true;
        }
        this.updateHeaderSortIcons();
        this.sortAndRender();
      });
    });

    // Scroll listener on container for virtualization
    this.container.addEventListener('scroll', () => {
      this.render();
    }, { passive: true });
  }

  updateHeaderSortIcons() {
    const ths = this.table.querySelectorAll('th[data-sort]');
    ths.forEach(th => {
      const key = th.getAttribute('data-sort');
      const icon = th.querySelector('.sort-icon');
      if (icon) {
        if (this.sortKey === key) {
          icon.textContent = this.sortAsc ? ' ▲' : ' ▼';
        } else {
          icon.textContent = '';
        }
      }
    });
  }

  setRows(rows) {
    this.rows = rows || [];
    this.sortAndRender();
  }

  sortAndRender() {
    if (this.sortKey) {
      const key = this.sortKey;
      const asc = this.sortAsc ? 1 : -1;

      this.rows.sort((a, b) => {
        let valA = a[key];
        let valB = b[key];

        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;

        if (typeof valA === 'number' && typeof valB === 'number') {
          return (valA - valB) * asc;
        }
        return String(valA).localeCompare(String(valB)) * asc;
      });
    }

    this.render();
  }

  render() {
    if (!this.tbody) return;

    const total = this.rows.length;
    if (total === 0) {
      this.tbody.innerHTML = '';
      return;
    }

    const containerHeight = this.container.clientHeight || 500;
    const scrollTop = this.container.scrollTop;

    // Calculate viewport visible indices
    const visibleCount = Math.ceil(containerHeight / ROW_HEIGHT);
    const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_COUNT);
    const endIndex = Math.min(total, startIndex + visibleCount + (BUFFER_COUNT * 2));

    const topSpacerHeight = startIndex * ROW_HEIGHT;
    const bottomSpacerHeight = (total - endIndex) * ROW_HEIGHT;

    let html = '';

    if (topSpacerHeight > 0) {
      html += `<tr style="height: ${topSpacerHeight}px;"><td colspan="8" style="padding:0;border:none;"></td></tr>`;
    }

    for (let i = startIndex; i < endIndex; i++) {
      const row = this.rows[i];
      const name = this.escapeHtml(row.name || '—');
      const rating = row.rating ? `★ ${row.rating}` : '—';
      const reviews = row.reviewCount ? row.reviewCount.toLocaleString() : '—';
      const category = this.escapeHtml(row.category || '—');
      
      // Contact / Phone cell
      let phoneDisplay = '—';
      if (row.phone) {
        phoneDisplay = `<span title="${this.escapeHtml(row.phone)}">${this.escapeHtml(row.phone)}</span>`;
      }

      // Website & Socials cell
      let webBadges = '';
      if (row.website) {
        webBadges += `<a href="${this.escapeHtml(row.website)}" target="_blank" title="Website: ${this.escapeHtml(row.website)}">${this.escapeHtml(row.domain || 'website')}</a>`;
      } else {
        webBadges += '<span style="color:var(--text-muted)">none</span>';
      }

      if (row.email) {
        webBadges += ` <a href="mailto:${this.escapeHtml(row.email)}" title="Email: ${this.escapeHtml(row.email)}" style="font-size:11px;text-decoration:none;">✉️</a>`;
      }
      if (row.instagram) {
        webBadges += ` <a href="${this.escapeHtml(row.instagram)}" target="_blank" title="Instagram: ${this.escapeHtml(row.instagram)}" style="font-size:11px;text-decoration:none;">📸</a>`;
      }

      const address = this.escapeHtml(row.address || '—');

      html += `
        <tr data-index="${i}" style="height: ${ROW_HEIGHT}px;" class="table-row-item">
          <td>${i + 1}</td>
          <td title="${name}"><b>${name}</b></td>
          <td>${rating}</td>
          <td>${reviews}</td>
          <td title="${category}">${category}</td>
          <td>${phoneDisplay}</td>
          <td>${webBadges}</td>
          <td title="${address}">${address}</td>
        </tr>
      `;
    }

    if (bottomSpacerHeight > 0) {
      html += `<tr style="height: ${bottomSpacerHeight}px;"><td colspan="8" style="padding:0;border:none;"></td></tr>`;
    }

    this.tbody.innerHTML = html;

    // Add row click listeners
    const trs = this.tbody.querySelectorAll('tr.table-row-item');
    trs.forEach(tr => {
      const idx = parseInt(tr.getAttribute('data-index'), 10);
      const rowData = this.rows[idx];
      if (rowData) {
        tr.addEventListener('click', (e) => {
          if (e.target.tagName !== 'A') {
            this.onRowClick(rowData);
          }
        });
      }
    });
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }
}
