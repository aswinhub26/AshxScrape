/**
 * Filter Bar Controller
 * Supports text search, min rating, review count, phone presence, and the "No Website" money filter.
 */

export class FilterBar {
  constructor(domElements, onFilterChange) {
    this.el = domElements;
    this.onFilterChange = onFilterChange || (() => {});

    this.filters = {
      searchTerm: '',
      minRating: 0,
      minReviews: 0,
      hasPhone: false,
      noWebsite: false,
      hasWebsite: false
    };

    this.bindEvents();
  }

  bindEvents() {
    // Text search input
    if (this.el.filterText) {
      this.el.filterText.addEventListener('input', (e) => {
        this.filters.searchTerm = e.target.value.toLowerCase().trim();
        this.onFilterChange();
      });
    }

    // No Website toggle (Money filter)
    if (this.el.filterNoWeb) {
      this.el.filterNoWeb.addEventListener('click', () => {
        this.filters.noWebsite = !this.filters.noWebsite;
        if (this.filters.noWebsite) {
          this.filters.hasWebsite = false;
          this.el.filterHasWeb?.classList.remove('active');
        }
        this.el.filterNoWeb.classList.toggle('active', this.filters.noWebsite);
        this.onFilterChange();
      });
    }

    // Has Phone toggle
    if (this.el.filterHasPhone) {
      this.el.filterHasPhone.addEventListener('click', () => {
        this.filters.hasPhone = !this.filters.hasPhone;
        this.el.filterHasPhone.classList.toggle('active', this.filters.hasPhone);
        this.onFilterChange();
      });
    }

    // Has Website toggle
    if (this.el.filterHasWeb) {
      this.el.filterHasWeb.addEventListener('click', () => {
        this.filters.hasWebsite = !this.filters.hasWebsite;
        if (this.filters.hasWebsite) {
          this.filters.noWebsite = false;
          this.el.filterNoWeb?.classList.remove('active');
        }
        this.el.filterHasWeb.classList.toggle('active', this.filters.hasWebsite);
        this.onFilterChange();
      });
    }

    // Rating selector
    if (this.el.filterMinRating) {
      this.el.filterMinRating.addEventListener('change', (e) => {
        this.filters.minRating = parseFloat(e.target.value) || 0;
        this.onFilterChange();
      });
    }
  }

  apply(rows) {
    if (!rows || rows.length === 0) return [];

    return rows.filter(row => {
      // 1. Text search filter
      if (this.filters.searchTerm) {
        const term = this.filters.searchTerm;
        const name = (row.name || '').toLowerCase();
        const cat = (row.category || '').toLowerCase();
        const addr = (row.address || '').toLowerCase();
        if (!name.includes(term) && !cat.includes(term) && !addr.includes(term)) {
          return false;
        }
      }

      // 2. Rating filter
      if (this.filters.minRating > 0) {
        if (!row.rating || row.rating < this.filters.minRating) {
          return false;
        }
      }

      // 3. Min reviews filter
      if (this.filters.minReviews > 0) {
        if (!row.reviewCount || row.reviewCount < this.filters.minReviews) {
          return false;
        }
      }

      // 4. Has Phone filter
      if (this.filters.hasPhone) {
        if (!row.phone && !row.phoneRaw) {
          return false;
        }
      }

      // 5. No Website filter (the lead-gen money filter)
      if (this.filters.noWebsite) {
        if (row.website) {
          return false;
        }
      }

      // 6. Has Website filter
      if (this.filters.hasWebsite) {
        if (!row.website) {
          return false;
        }
      }

      return true;
    });
  }

  reset() {
    this.filters = {
      searchTerm: '',
      minRating: 0,
      minReviews: 0,
      hasPhone: false,
      noWebsite: false,
      hasWebsite: false
    };
    if (this.el.filterText) this.el.filterText.value = '';
    if (this.el.filterNoWeb) this.el.filterNoWeb.classList.remove('active');
    if (this.el.filterHasPhone) this.el.filterHasPhone.classList.remove('active');
    if (this.el.filterHasWeb) this.el.filterHasWeb.classList.remove('active');
    if (this.el.filterMinRating) this.el.filterMinRating.value = '0';
    this.onFilterChange();
  }
}
