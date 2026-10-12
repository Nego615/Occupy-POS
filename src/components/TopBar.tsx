import { useLayoutEffect, useRef, type ReactNode } from 'react';
import './TopBar.css';
import { useClock } from '../lib/useClock';
import { BrandMark } from './BrandMark';
import { Mono } from './Mono';

export type TopBarProps = {
  /** Business name beside the brand mark. */
  brand: string;
  /** Uploaded logo from Settings; null shows the built-in mark. */
  logo: string | null;
  /** Station line under the brand mark, e.g. "Front Counter · Register 1". */
  station: string;
  /** The signed-in person's control at the far right — supplied by the layout. */
  account?: ReactNode;
  /** The register shows a live clock; other counter screens don't. */
  showClock?: boolean;
  /** Route switcher, supplied by the layout that owns the bar. */
  nav?: ReactNode;
};

export function TopBar({ brand, logo, station, account, showClock = false, nav }: TopBarProps) {
  const ref = useRef<HTMLElement>(null);

  // The bar sticks to the top of the screen; publishing its height lets menus
  // further down the page (the register's categories) pin just beneath it.
  useLayoutEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--topbar-h');
    };
  }, []);

  return (
    <header className="topbar" ref={ref}>
      <div className="topbar__brand">
        <BrandMark logo={logo} />
        <div>
          <div className="brand-name">{brand}</div>
          <div className="brand-sub">{station}</div>
        </div>
      </div>
      <div className="topbar__right">
        {nav}
        {showClock && <Clock />}
        {account}
      </div>
    </header>
  );
}

function Clock() {
  const { date, time } = useClock();
  return (
    <div className="topbar__clock">
      {date} · <Mono className="topbar__time">{time}</Mono>
    </div>
  );
}
