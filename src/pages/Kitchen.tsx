import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useNavigate } from 'react-router';
import './Kitchen.css';
import { AccountMenu } from '../components/AccountMenu';
import { Button } from '../components/Button';
import { Mono } from '../components/Mono';
import { Pill, PillGroup } from '../components/Pill';
import { StatusChip } from '../components/StatusChip';
import { TopBar } from '../components/TopBar';
import { formatElapsed, type KitchenTicket } from '../data/kitchen';
import { ADMIN_PERMISSIONS } from '../data/staff';
import { quick, snap } from '../lib/motion';
import { usePos } from '../lib/store';
import { formatTime, useNow } from '../lib/useClock';

type View = 'waiting' | 'done';

/** How long a ticket reads as new after it lands. */
const NEW_FOR_MS = 60_000;
/** How many bumped tickets the Done view keeps within reach for a recall. */
const DONE_SHOWN = 40;

/**
 * The kitchen display. Tickets arrive from the register oldest first, each
 * with a timer running since it was sent; a cook taps Start when they pick
 * one up, crosses lines off as they're made, and bumps the ticket once it's
 * out. Done holds recent bumps so a ticket cleared by mistake can be recalled.
 */
export function Kitchen() {
  const navigate = useNavigate();
  const { kitchenTickets, bumpTicket, recallTicket, toggleTicketLine, toggleTicketStarted, can, settings } =
    usePos();
  const [view, setView] = useState<View>('waiting');
  const now = useNow();
  const lateAfterMs = settings.kitchenLateMinutes * 60_000;

  const waiting = kitchenTickets.filter((k) => k.bumpedAt === null);
  const done = kitchenTickets
    .filter((k) => k.bumpedAt !== null)
    .sort((a, b) => b.bumpedAt! - a.bumpedAt!)
    .slice(0, DONE_SHOWN);
  const lateCount = waiting.filter((k) => isLate(k, now, lateAfterMs)).length;
  const notStarted = waiting.filter((k) => k.kind === 'order' && k.startedAt === undefined).length;
  const oldest = waiting[0];

  return (
    <div className="kitchen">
      <TopBar
        brand={settings.businessName}
        logo={settings.logo}
        station={`${settings.locationName} · Kitchen`}
        account={<AccountMenu />}
        showClock
        nav={
          <nav className="kitchen__nav" aria-label="Kitchen">
            <PillGroup>
              <Pill active={view === 'waiting'} onClick={() => setView('waiting')}>
                Waiting <Mono>{waiting.length}</Mono>
              </Pill>
              <Pill active={view === 'done'} onClick={() => setView('done')}>
                Done
              </Pill>
            </PillGroup>
            {can('register') && (
              <Pill onClick={() => navigate('/counter/register')}>Register</Pill>
            )}
            {/* Cooks keep the menu and set meals there. */}
            {ADMIN_PERMISSIONS.some(can) && <Pill onClick={() => navigate('/admin')}>Admin</Pill>}
          </nav>
        }
      />

      {view === 'waiting' ? (
        <main className="kitchen__body">
          <div className="kitchen__summary" aria-live="polite">
            {waiting.length === 0 ? (
              'All clear'
            ) : (
              <>
                <Mono>{waiting.length}</Mono> {waiting.length === 1 ? 'ticket' : 'tickets'} waiting
                {notStarted > 0 && (
                  <>
                    {' · '}
                    <Mono>{notStarted}</Mono> not started
                  </>
                )}
                {' · '}oldest <Mono>{formatElapsed(now - oldest.sentAt)}</Mono>
                {lateCount > 0 && (
                  <StatusChip status="occupied" size="sm" className="kitchen__late-count">
                    {lateCount} late
                  </StatusChip>
                )}
              </>
            )}
          </div>

          {/* A new ticket settles in; a bumped one drops out and the rest close
              up behind it, so the line can see what just left. */}
          <div className="kitchen__grid">
            <AnimatePresence initial={false} mode="popLayout">
              {waiting.map((ticket) => (
                <motion.div
                  key={ticket.id}
                  layout="position"
                  transition={snap}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1, transition: quick }}
                  exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
                >
                  <Ticket
                    ticket={ticket}
                    now={now}
                    late={isLate(ticket, now, lateAfterMs)}
                    onToggleLine={(i) => toggleTicketLine(ticket.id, i)}
                    onToggleStarted={() => toggleTicketStarted(ticket.id)}
                    onBump={() => bumpTicket(ticket.id)}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {waiting.length === 0 && (
            <p className="kitchen__empty">
              No tickets waiting — new orders show up here as soon as the register sends them.
            </p>
          )}
        </main>
      ) : (
        <main className="kitchen__body">
          <div className="kitchen__summary">Recently bumped — recall one to put it back up.</div>
          {done.length === 0 ? (
            <p className="kitchen__empty">Nothing bumped yet — cleared tickets land here.</p>
          ) : (
            <ul className="done-list">
              {done.map((ticket) => (
                <li key={ticket.id} className="done-row">
                  <div className="done-row__who">
                    <span className="done-row__tab">{ticket.tabName}</span>
                    <Mono className="done-row__id">{`#${ticket.orderId}`}</Mono>
                    {ticket.kind === 'void' && (
                      <StatusChip status="refunded" size="sm">
                        Void
                      </StatusChip>
                    )}
                  </div>
                  <div className="done-row__items">{summarize(ticket)}</div>
                  <div className="done-row__time">
                    bumped <Mono>{formatTime(new Date(ticket.bumpedAt!))}</Mono> · took{' '}
                    <Mono>{formatElapsed(ticket.bumpedAt! - ticket.sentAt)}</Mono>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      recallTicket(ticket.id);
                      setView('waiting');
                    }}
                  >
                    Recall
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </main>
      )}
    </div>
  );
}

function Ticket({
  ticket,
  now,
  late,
  onToggleLine,
  onToggleStarted,
  onBump,
}: {
  ticket: KitchenTicket;
  now: number;
  late: boolean;
  onToggleLine: (index: number) => void;
  onToggleStarted: () => void;
  onBump: () => void;
}) {
  const isVoid = ticket.kind === 'void';
  const started = !isVoid && ticket.startedAt !== undefined;
  const allDone = ticket.lines.every((l) => l.done);
  // Once someone's on it, it isn't new any more.
  const isNew = !started && now - ticket.sentAt < NEW_FOR_MS;
  const classes = ['ticket', late ? 'ticket--late' : '', isVoid ? 'ticket--void' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <article className={classes} aria-label={`${ticket.tabName}, order ${ticket.orderId}`}>
      <header className="ticket__head">
        <div className="ticket__who">
          <div className="ticket__tab">{ticket.tabName}</div>
          <div className="ticket__meta">
            <Mono>{`#${ticket.orderId}`}</Mono> · sent <Mono>{formatTime(new Date(ticket.sentAt))}</Mono>
          </div>
        </div>
        <Mono className="ticket__timer">{formatElapsed(now - ticket.sentAt)}</Mono>
      </header>

      {(isVoid || late || ticket.fire > 1 || isNew) && (
        <div className="ticket__flags">
          {isVoid && (
            <StatusChip status="refunded" size="sm">
              Void — stop making
            </StatusChip>
          )}
          {late && (
            <StatusChip status="occupied" size="sm">
              Late
            </StatusChip>
          )}
          {!isVoid && ticket.fire > 1 && (
            <StatusChip status="occupied" size="sm">
              Added to tab · fire {ticket.fire}
            </StatusChip>
          )}
          {!late && isNew && (
            <StatusChip status="open" size="sm">
              New
            </StatusChip>
          )}
        </div>
      )}

      <ul className="ticket__lines">
        {ticket.lines.map((line, i) => (
          <li key={`${line.itemId}|${line.note ?? ''}|${(line.addOns ?? []).join(',')}`}>
            <button
              type="button"
              className={line.done ? 'ticket-line ticket-line--done' : 'ticket-line'}
              aria-pressed={line.done}
              onClick={() => onToggleLine(i)}
            >
              <Mono className="ticket-line__qty">{isVoid ? `−${line.qty}` : line.qty}</Mono>
              <span className="ticket-line__name">
                {line.name}
                {line.addOns && <span className="ticket-line__addons">with {line.addOns.join(', ')}</span>}
                {line.note && <span className="ticket-line__note">{line.note}</span>}
              </span>
              <span className="ticket-line__check" aria-hidden="true">
                ✓
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="ticket__foot">
        {/* Tapped again, it un-starts — for a ticket started by mistake. */}
        {!isVoid && (
          <button
            type="button"
            className={started ? 'ticket-start ticket-start--on' : 'ticket-start'}
            aria-pressed={started}
            onClick={onToggleStarted}
            title={started ? 'Tap again if it was started by mistake' : undefined}
          >
            <span className="ticket-start__mark" aria-hidden="true">
              ✓
            </span>
            {started ? (
              <span className="ticket-start__label">
                Started
                <span className="ticket-start__by">
                  <Mono>{formatTime(new Date(ticket.startedAt!))}</Mono>
                  {/* First name — the kitchen knows who's who, and a full name won't fit beside Bump. */}
                  {ticket.startedBy && ` · ${ticket.startedBy.split(' ')[0]}`}
                </span>
              </span>
            ) : (
              <span className="ticket-start__label">Start</span>
            )}
          </button>
        )}
        <Button
          size="lg"
          block={isVoid}
          className={isVoid ? undefined : 'ticket__bump'}
          variant={allDone || isVoid ? 'primary' : 'secondary'}
          onClick={onBump}
        >
          {isVoid ? 'Got it — clear' : 'Bump'}
        </Button>
      </div>
    </article>
  );
}

function isLate(ticket: KitchenTicket, now: number, lateAfterMs: number): boolean {
  return ticket.kind === 'order' && now - ticket.sentAt >= lateAfterMs;
}

/** "2 × Grain Bowl, 1 × Grilled Chicken with Chips (no salt)". */
function summarize(ticket: KitchenTicket): string {
  return ticket.lines
    .map((l) => `${l.qty} × ${l.name}${l.addOns ? ` with ${l.addOns.join(', ')}` : ''}${l.note ? ` (${l.note})` : ''}`)
    .join(', ');
}
