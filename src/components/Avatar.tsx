import './Avatar.css';
import { initials } from '../data/staff';

export type AvatarProps = {
  name: string;
  /** Greys the avatar for deactivated staff. */
  muted?: boolean;
};

/** Initials disc for a staff member. Decorative; the name always sits beside it. */
export function Avatar({ name, muted = false }: AvatarProps) {
  return (
    <span className={muted ? 'avatar avatar--muted' : 'avatar'} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
