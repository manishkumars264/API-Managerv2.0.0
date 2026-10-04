import { cloneElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import './ResponseTooltip.css';

interface Props { label: string; children: ReactElement<{ 'aria-describedby'?: string }>; }

/** Toolbar hints use the response area below Find rather than covering its controls. */
export function ResponseTooltip({ label, children }: Props) {
  const anchor = useRef<HTMLSpanElement>(null), tooltip = useRef<HTMLDivElement>(null);
  const delay = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false), [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const close = useCallback(() => { clearTimeout(delay.current); setOpen(false); }, []);
  const show = () => { clearTimeout(delay.current); delay.current = setTimeout(() => setOpen(true), 350); };
  useEffect(() => () => clearTimeout(delay.current), []);
  useLayoutEffect(() => {
    if (!open || !anchor.current || !tooltip.current) return;
    const update = () => {
      if (!anchor.current || !tooltip.current) return;
      const rect = anchor.current.getBoundingClientRect(), hint = tooltip.current.getBoundingClientRect();
      const find = anchor.current.closest('.response-panel')?.querySelector<HTMLElement>('.response-body .find-widget');
      const findRect = find?.getBoundingClientRect();
      const findVisible = !!findRect && findRect.width > 0 && findRect.height > 0 && find?.classList.contains('visible');
      const top = Math.max(rect.bottom, findVisible ? findRect.bottom : 0) + 8;
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - hint.width / 2, window.innerWidth - hint.width - 8));
      setPosition({ left, top: Math.min(top, Math.max(8, window.innerHeight - hint.height - 8)) });
    };
    update();
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    const panel = anchor.current.closest('.response-panel');
    const observer = new MutationObserver(records => {
      // Opening/closing Find or changing modes dismisses a hint for an old control.
      if (records.some(record => record.target instanceof Element && (record.target.matches('.find-widget') || record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element && (node.matches('.find-widget') || node.querySelector('.find-widget')))))) close();
    });
    if (panel) observer.observe(panel, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'] });
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); observer.disconnect(); };
  }, [open, label, close]);
  return <span ref={anchor} className="response-tooltip-anchor" onPointerEnter={show} onPointerLeave={close} onFocusCapture={show} onBlurCapture={close} onClickCapture={close} onKeyDown={event => { if (event.key === 'Escape') close(); }}>
    {cloneElement(children, { 'aria-describedby': open ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'] })}
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className="response-toolbar-tooltip" data-tooltip-anchor="response-control" style={position}>{label}</div>, document.body)}
  </span>;
}
