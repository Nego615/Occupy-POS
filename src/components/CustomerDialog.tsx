import './CustomerDialog.css';
import { Button } from './Button';
import { ClientPicker } from './ClientPicker';
import { Modal } from './CounterDialogs';
import { usePos } from '../lib/store';

/**
 * Puts the register's tab in a client's name — a regular, or someone new
 * added on the spot. The name goes on the docket and receipt, and is offered
 * first if the bill goes on their account.
 */
export function CustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tab, setTabCustomer } = usePos();

  return (
    <Modal open={open} title="Customer" sub="Who is this order for?" onClose={onClose}>
      <ClientPicker
        value={tab.customerId ?? null}
        onChange={(id) => {
          setTabCustomer(id);
          if (id) onClose();
        }}
      />
      {tab.customerId && (
        <div className="customer-dialog__foot">
          <Button
            variant="secondary"
            onClick={() => {
              setTabCustomer(null);
              onClose();
            }}
          >
            Remove {tab.customerName ?? 'customer'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
