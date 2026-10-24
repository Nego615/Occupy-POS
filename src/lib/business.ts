import { createContext, useContext } from 'react';

/**
 * What kind of shop this is, as the platform sets it. A hospitality shop runs
 * tables, a kitchen, set meals and recipes; a retail shop sells goods off the
 * shelf — scanned by barcode, in sizes and colours — and has none of those.
 */
export type BusinessType = 'hospitality' | 'retail';

export const BUSINESS_TYPES: { id: BusinessType; label: string }[] = [
  { id: 'hospitality', label: 'Hospitality' },
  { id: 'retail', label: 'Retail' },
];

export function businessTypeLabel(type: BusinessType): string {
  return BUSINESS_TYPES.find((t) => t.id === type)!.label;
}

/** Anything the platform didn't say, or said in a way this build doesn't know, is hospitality. */
export function asBusinessType(value: unknown): BusinessType {
  return value === 'retail' ? 'retail' : 'hospitality';
}

const OVERRIDE_KEY = 'occupy-pos:business-type';

/**
 * A shop's module is the platform admin's to assign, on /platform — nothing on
 * the device can change it. For trying the screens in development only, set
 * `localStorage['occupy-pos:business-type'] = 'retail'`; a production build
 * never reads it.
 */
export function devBusinessType(): BusinessType | null {
  if (!import.meta.env.DEV) return null;
  try {
    const set = localStorage.getItem(OVERRIDE_KEY);
    return set ? asBusinessType(set) : null;
  } catch {
    return null;
  }
}

export const BusinessContext = createContext<BusinessType>('hospitality');

export function useBusiness(): { type: BusinessType; retail: boolean } {
  const type = useContext(BusinessContext);
  return { type, retail: type === 'retail' };
}
