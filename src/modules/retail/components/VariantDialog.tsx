import { Modal } from '../../../components/CounterDialogs';
import { Money } from '../../../components/Mono';
import { stockFits, type CatalogItem } from '../../../data/catalog';
import { bestPromo } from '../../../data/deals';
import { variantLabel, variantsOf, type Product } from '../../../data/products';
import { itemQuantities, portionLine } from '../../../lib/cart';
import { usePos } from '../../../lib/store';

/**
 * Which size or colour of a product to ring up. `onPick` rings the variant up
 * as the till would a tile — so an open price still asks for one.
 */
export function VariantDialog({
  product,
  onPick,
  onClose,
}: {
  product: Product | null;
  onPick: (variant: CatalogItem) => void;
  onClose: () => void;
}) {
  const { cart, catalog, promotions, categories, settings } = usePos();
  const onTab = itemQuantities(cart);
  const variants = product ? variantsOf(catalog, product.id).filter((v) => v.available) : [];

  return (
    <Modal
      open={product !== null}
      title={product?.name ?? ''}
      sub={product ? `Which ${product.options.map((o) => o.name.toLowerCase()).join(' and ')}?` : undefined}
      onClose={onClose}
    >
      <div className="portion-options">
        {variants.length === 0 && <p className="counter-dialog__sub">None of these are for sale right now.</p>}
        {variants.map((v) => {
          const inCart = onTab.get(v.id) ?? 0;
          const fits = stockFits(v, inCart);
          const left = v.untracked ? null : v.stock - inCart;
          const line = portionLine(v, null, bestPromo(promotions, v, new Date(), categories));
          return (
            <button
              key={v.id}
              type="button"
              className="portion-option"
              disabled={!fits}
              onClick={() => {
                onClose();
                onPick(v);
              }}
            >
              <span className="portion-option__label">
                {variantLabel(v.variant ?? [])}
                {left !== null && fits && left <= (v.lowStockAt ?? settings.lowStockDefault) && (
                  <span className="portion-option__share mono"> · {left} left</span>
                )}
              </span>
              <span className="portion-option__price">
                {fits ? (
                  <>
                    {line.listPrice !== undefined && (
                      <s>
                        <Money value={line.listPrice} />
                      </s>
                    )}{' '}
                    <Money value={line.unitPrice} />
                  </>
                ) : inCart > 0 ? (
                  'All on this sale'
                ) : (
                  'Sold out'
                )}
              </span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
