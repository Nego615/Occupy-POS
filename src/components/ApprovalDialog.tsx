import { useEffect, useRef } from 'react';
import './ApprovalDialog.css';
import { PinPad } from './PinPad';
import { permissionLabel, type Permission, type StaffMember } from '../data/staff';
import { usePos } from '../lib/store';

export type ApprovalDialogProps = {
  open: boolean;
  /** What the approver's role must grant. */
  permission: Permission;
  /** The action being okayed, e.g. "Refund #1043 · TSh 24,500". */
  action: string;
  onApproved: (approver: StaffMember) => void;
  onClose: () => void;
};

/**
 * Manager override. Someone whose role can do `permission` enters their PIN
 * to okay one action for whoever is signed in — the session doesn't change.
 */
export function ApprovalDialog({
  open,
  permission,
  action,
  onApproved,
  onClose,
}: ApprovalDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const { approve } = usePos();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function check(pin: string): string | null {
    const approver = approve(pin, permission);
    if (!approver) {
      return `That PIN can’t ${permissionLabel(permission).toLowerCase()}. Ask a manager or owner.`;
    }
    onApproved(approver);
    return null;
  }

  return (
    <dialog
      ref={ref}
      className="approval"
      aria-labelledby="approval-title"
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="approval__body">
        <header className="approval__head">
          <h2 id="approval-title" className="approval__title">
            Manager approval
          </h2>
          <button
            type="button"
            className="approval__close"
            onClick={onClose}
            aria-label="Cancel approval"
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <p className="approval__action">{action}</p>
        <p className="approval__hint">A manager or owner enters their PIN to approve.</p>
        {/* Remounted each time it opens, so a half-typed PIN never lingers. */}
        {open && <PinPad label="Approver PIN" onComplete={check} />}
      </div>
    </dialog>
  );
}
