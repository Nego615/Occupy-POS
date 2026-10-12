import './ThemeToggle.css';
import { Icon } from './Icon';
import { setTheme, useTheme } from '../lib/theme';

/** One tap between light and dark. Shows where it'll take you: a moon in light, a sun in dark. */
export function ThemeToggle({ className }: { className?: string }) {
  const dark = useTheme() === 'dark';
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <button
      type="button"
      className={className ? `theme-toggle ${className}` : 'theme-toggle'}
      aria-label={label}
      title={label}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <Icon name={dark ? 'sun' : 'moon'} size={20} />
    </button>
  );
}
