import './SearchField.css';

export type SearchFieldProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** Accessible name — the placeholder alone disappears once typing starts. */
  label: string;
};

/** Rounded search input with a leading glyph, for list toolbars. */
export function SearchField({ value, onChange, placeholder, label }: SearchFieldProps) {
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
        placeholder={placeholder}
        aria-label={label}
      />
    </div>
  );
}
