import '../../../components/SearchField.css';

/**
 * The till's search box, which a scanner can type into too: Enter hands its
 * text to `onEnter` to be looked up as a code.
 */
export function ScanField({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter: (value: string) => void;
}) {
  return (
    <div className="search">
      <span className="search__icon" aria-hidden="true">
        ⌕
      </span>
      <input
        className="search__input"
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          onEnter(e.currentTarget.value);
        }}
        placeholder="Search or scan"
        aria-label="Search products, or scan or type a barcode or SKU"
      />
    </div>
  );
}
