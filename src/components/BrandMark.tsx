/**
 * The square beside the business name. Shows the uploaded logo when there is
 * one, and the built-in mark otherwise. Decorative — the name sits next to it.
 */
export function BrandMark({ logo }: { logo: string | null }) {
  return logo ? (
    <img className="brand-mark brand-mark--logo" src={logo} alt="" aria-hidden="true" />
  ) : (
    <div className="brand-mark" aria-hidden="true" />
  );
}
