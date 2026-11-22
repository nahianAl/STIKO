'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import s from './SiteNav.module.css';

/**
 * The marketing site's nav bar (www.stiko.design), rebuilt for app pages a
 * visitor reaches FROM that site, so the menu does not vanish on the way in.
 * Today that is /pricing.
 *
 * KEEP IN STEP with Webflow: links, labels and looks are copied from the home
 * page's `.stk-nav` (markup, `stikos-sublime-site.webflow.shared.css` and its
 * inline script). The behaviour matches that script: on a hover-capable
 * screen 992px and up, Solutions opens on hover and closes 350ms after the
 * pointer leaves; anywhere else it opens on click. Outside clicks, Escape and
 * following a link close everything.
 */

export const MARKETING = 'https://www.stiko.design';

const SOLUTIONS = [
  {
    href: `${MARKETING}/industrial-design`,
    title: 'Industrial Design & Concept Development',
    blurb: 'Turn concept sketches into approved designs, faster',
  },
  {
    href: `${MARKETING}/product-development-manufacturing`,
    title: 'Product Development & Manufacturing',
    blurb: 'Catch manufacturability issues before the shop floor',
  },
  {
    href: `${MARKETING}/architecture-interior-construction`,
    title: 'Architecture, Interior & Construction',
    blurb: 'Every revision, redline and approval in one place',
  },
  {
    href: `${MARKETING}/graphic-design-video-photography`,
    title: 'Graphic Design, Video & Photography',
    blurb: 'Frame-accurate feedback on every cut and layout',
  },
];

export default function SiteNav({
  session,
  loginHref,
  signupHref,
  account,
}: {
  /** 'loading' shows neither the sign-in links nor the account, so nothing flashes. */
  session: 'loading' | 'signed-in' | 'signed-out';
  loginHref: string;
  signupHref: string;
  /** Rendered at the right for a signed-in visitor (the avatar menu). */
  account?: React.ReactNode;
}) {
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(hover:hover) and (min-width:992px)');
    const update = () => setCanHover(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setSolutionsOpen(false);
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSolutionsOpen(false);
        setMenuOpen(false);
      }
    };
    // Width changes only: mobile browsers fire resize as the URL bar slides.
    let lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth === lastW) return;
      lastW = window.innerWidth;
      setSolutionsOpen(false);
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  const openNow = () => {
    window.clearTimeout(closeTimer.current);
    setSolutionsOpen(true);
  };
  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setSolutionsOpen(false), 350);
  };

  return (
    <div className={s.nav} ref={rootRef}>
      <div className={s.bar}>
        <a href={MARKETING} className={s.brand} aria-label="stiko home">
          {/* eslint-disable-next-line @next/next/no-img-element -- a 2 KB SVG; next/image adds nothing */}
          <img src="/marketing/stiko-logo.svg" alt="stiko logo" width={67.92} height={24} className={s.logo} />
        </a>

        <div className={s.links}>
          <div
            className={s.dd}
            onMouseEnter={canHover ? openNow : undefined}
            onMouseLeave={canHover ? closeSoon : undefined}
          >
            <button
              type="button"
              className={s.ddTrigger}
              aria-expanded={solutionsOpen}
              aria-controls="site-nav-solutions"
              onClick={() => (canHover ? openNow() : setSolutionsOpen((o) => !o))}
            >
              Solutions
            </button>
            {solutionsOpen && (
              <div id="site-nav-solutions" className={s.ddMenu}>
                {SOLUTIONS.map((x) => (
                  <a key={x.href} href={x.href} className={s.ddCard} onClick={() => setSolutionsOpen(false)}>
                    <p className={s.ddCardH}>{x.title}</p>
                    <p className={s.ddCardP}>{x.blurb}</p>
                  </a>
                ))}
              </div>
            )}
          </div>
          <Link href="/pricing" className={`${s.navLink} ${s.current}`} aria-current="page">
            Pricing
          </Link>
        </div>

        <div className={s.right}>
          {session === 'signed-out' && (
            <>
              <Link href={loginHref} className={s.navLink}>
                Log in
              </Link>
              <Link href={signupHref} className={`${s.btn} ${s.btnSm}`}>
                Get started
              </Link>
            </>
          )}
          {session === 'signed-in' && (
            <>
              <Link href="/" className={s.navLink}>
                Your projects
              </Link>
              {account}
            </>
          )}

          <div className={s.mnav}>
            <button
              type="button"
              className={`${s.mnavBtn} ${menuOpen ? s.mnavOpen : ''}`}
              aria-expanded={menuOpen}
              aria-controls="site-nav-mobile"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className={s.mnavLine} />
              <span className={s.mnavLine} />
              <span className={s.mnavLine} />
            </button>
            {menuOpen && (
              <div id="site-nav-mobile" className={s.mnavMenu} onClick={(e) => {
                if ((e.target as HTMLElement).closest('a')) setMenuOpen(false);
              }}>
                <a href={`${MARKETING}/#product`} className={s.mnavLink}>
                  Product
                </a>
                <Link href="/pricing" className={s.mnavLink} aria-current="page">
                  Pricing
                </Link>
                <div className={s.mnavHead}>Solutions</div>
                {SOLUTIONS.map((x) => (
                  <a key={x.href} href={x.href} className={s.mnavSub}>
                    {x.title}
                  </a>
                ))}
                <div className={s.mnavRule} />
                {session === 'signed-in' ? (
                  <Link href="/" className={`${s.btn} ${s.mnavCta}`}>
                    Your projects
                  </Link>
                ) : (
                  <>
                    <Link href={loginHref} className={s.mnavLink}>
                      Log in
                    </Link>
                    <Link href={signupHref} className={`${s.btn} ${s.mnavCta}`}>
                      Get started
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
