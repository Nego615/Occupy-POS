/**
 * Occupy Retail's own identity — what tells a retail register apart from a
 * hospitality one. Colours live in theme.css; the name and mark live here.
 * A shop's own logo, set in Settings, still takes the mark's place.
 */
export const RETAIL_BRAND = {
  /** The product's name: the browser tab, and the line under the shop's name. */
  productName: 'Occupy Retail',
  /** An image URL for the mark, or null for the built-in Occupy scarab. */
  logo: null as string | null,
};

/** Tile colours offered for products — blues first, to sit with the retail palette. */
export const RETAIL_SWATCHES = ['#1f5fbf', '#0e8fb3', '#5a4fcf', '#1fae5c', '#e0a300', '#d93a26', '#0f2540'];
