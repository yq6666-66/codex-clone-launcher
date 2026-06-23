import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

export function CardMenu(props: { label: string; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open]);

  return (
    <div className="card-menu" ref={menuRef}>
      <button
        aria-expanded={open}
        aria-label={props.label}
        className="card-menu-trigger"
        disabled={props.disabled}
        onClick={() => setOpen((value) => !value)}
        title={props.label}
        type="button"
      >
        <MoreHorizontal size={16} />
      </button>
      {open ? (
        <div className="card-menu-popover" onClick={() => setOpen(false)} role="menu">
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
