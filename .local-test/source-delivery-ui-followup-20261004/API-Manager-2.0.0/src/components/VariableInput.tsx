import { cloneElement, forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactElement, type Ref, type RefObject, type TextareaHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import type { VariableToken } from '../lib/variable-details';
import { useVariableContext } from './VariableContext';
import './VariableInput.css';

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) { if (typeof ref === 'function') ref(value); else if (ref) ref.current = value; }
type Control = HTMLInputElement | HTMLTextAreaElement;
function VariableSurface({ value, element, masked = false, multiline = false, highlight = true, children }: { value: string; element: RefObject<Control | null>; masked?: boolean; multiline?: boolean; highlight?: boolean; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const context = useVariableContext();
  const tokens = useMemo(() => highlight ? context?.tokens(value) ?? [] : [], [context, value, highlight]);
  const mirror = useRef<HTMLSpanElement>(null), content = useRef<HTMLSpanElement>(null), popup = useRef<HTMLDivElement>(null);
  const tokenNodes = useRef(new Map<number, HTMLSpanElement>());
  const [hover, setHover] = useState<{ token: VariableToken; left: number; top: number; bottom: number } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const id = useId();
  const sync = useCallback(() => {
    const input = element.current, overlay = mirror.current, text = content.current;
    if (!input || !overlay || !text) return;
    const style = getComputedStyle(input), pixels = (key: string) => parseFloat(style.getPropertyValue(key)) || 0;
    Object.assign(overlay.style, {
      left: `${pixels('border-left-width') + pixels('padding-left')}px`, right: `${pixels('border-right-width') + pixels('padding-right')}px`,
      top: `${pixels('border-top-width') + pixels('padding-top')}px`, bottom: `${pixels('border-bottom-width') + pixels('padding-bottom')}px`,
      fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, fontStyle: style.fontStyle,
      letterSpacing: style.letterSpacing, lineHeight: style.lineHeight, textAlign: style.textAlign, direction: style.direction,
    });
    text.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    text.style.whiteSpace = multiline ? (input instanceof HTMLTextAreaElement && input.wrap === 'off' ? 'pre' : 'pre-wrap') : 'pre';
  }, [element, multiline]);
  useLayoutEffect(() => { sync(); setHover(null); }, [sync, value, context]);
  useEffect(() => {
    const input = element.current;
    if (!input) return;
    const observer = new ResizeObserver(sync); observer.observe(input);
    input.addEventListener('scroll', sync, { passive: true });
    input.addEventListener('keyup', sync); input.addEventListener('input', sync);
    return () => { observer.disconnect(); input.removeEventListener('scroll', sync); input.removeEventListener('keyup', sync); input.removeEventListener('input', sync); };
  }, [element, sync]);
  useEffect(() => {
    const close = () => setHover(null);
    window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, []);
  useLayoutEffect(() => {
    if (!hover || !popup.current) return;
    const rect = popup.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(hover.left, innerWidth - rect.width - 8)), top: hover.bottom + rect.height + 8 < innerHeight ? hover.bottom + 7 : Math.max(8, hover.top - rect.height - 7) });
  }, [hover]);
  const show = (token: VariableToken, rect: DOMRect) => setHover(previous => previous?.token === token && previous.left === rect.left && previous.bottom === rect.bottom ? previous : { token, left: rect.left, top: rect.top, bottom: rect.bottom });
  const parts: ReactElement[] = [];
  let offset = 0;
  for (const token of tokens) {
    if (token.start > offset) parts.push(<span key={`text-${offset}`}>{value.slice(offset, token.start)}</span>);
    parts.push(<span key={token.start} ref={node => { if (node) tokenNodes.current.set(token.start, node); else tokenNodes.current.delete(token.start); }} className={`variable-token variable-${token.details.status}`} data-variable-name={token.details.name}>{token.expression}</span>);
    offset = token.end;
  }
  if (offset < value.length) parts.push(<span key={`text-${offset}`}>{value.slice(offset)}</span>);
  if (multiline && value.endsWith('\n')) parts.push(<span key="trailing-newline">{'\u200b'}</span>);
  const details = hover?.token.details;
  const trim = (text: string) => text.length > 4096 ? `${text.slice(0, 4096)}…` : text;
  return <span className={`variable-input ${multiline ? 'variable-textarea' : ''} ${tokens.length && !masked ? 'variable-highlighted' : ''} ${tokens.length && masked ? 'variable-masked' : ''}`} onPointerMove={event => {
    if (event.buttons || !tokens.length) { setHover(null); return; }
    if (masked && element.current) { show(tokens[0], element.current.getBoundingClientRect()); return; }
    for (const token of tokens) {
      for (const rect of tokenNodes.current.get(token.start)?.getClientRects() ?? []) {
        if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) { show(token, rect); return; }
      }
    }
    setHover(null);
  }} onPointerLeave={() => setHover(null)} onFocusCapture={() => {
    sync(); if (tokens.length === 1 && element.current) show(tokens[0], element.current.getBoundingClientRect());
  }} onBlurCapture={() => setHover(null)} onKeyDownCapture={event => { if (event.key === 'Escape') setHover(null); }}>
    {cloneElement(children, { 'aria-describedby': hover ? [children.props['aria-describedby'], id].filter(Boolean).join(' ') : children.props['aria-describedby'] })}
    {!!tokens.length && !masked && <span ref={mirror} className="variable-input-mirror" aria-hidden="true"><span ref={content} className="variable-input-content">{parts}</span></span>}
    {details && createPortal(<div ref={popup} id={id} role="tooltip" className={`variable-value-tooltip variable-${details.status}`} data-variable-tooltip={details.name} style={position}>
      <strong>{`{{${details.name}}}`}</strong>
      <dl><dt>Scope</dt><dd>{details.source ? `${details.source.scope} · ${details.source.name}` : 'Unresolved'}</dd><dt>Environment</dt><dd>{details.environmentName || 'No environment selected'}</dd>{details.value !== undefined && <><dt>Value</dt><dd className="variable-tooltip-value">{trim(details.value) || '(empty string)'}</dd></>}</dl>
      {details.message && <p>{details.message}</p>}
    </div>, document.body)}
  </span>;
}

export interface VariableInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value'> { value: string; highlight?: boolean; }
export const VariableInput = forwardRef<HTMLInputElement, VariableInputProps>(function VariableInput({ value, highlight, ...props }, forwarded) {
  const element = useRef<HTMLInputElement | null>(null);
  const ref = useCallback((input: HTMLInputElement | null) => { element.current = input; assignRef(forwarded, input); }, [forwarded]);
  return <VariableSurface value={value} element={element} highlight={highlight} masked={props.type === 'password'}><input {...props} value={value} ref={ref} /></VariableSurface>;
});
export interface VariableTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> { value: string; }
export const VariableTextarea = forwardRef<HTMLTextAreaElement, VariableTextareaProps>(function VariableTextarea({ value, ...props }, forwarded) {
  const element = useRef<HTMLTextAreaElement | null>(null);
  const ref = useCallback((input: HTMLTextAreaElement | null) => { element.current = input; assignRef(forwarded, input); }, [forwarded]);
  return <VariableSurface value={value} element={element} multiline><textarea {...props} value={value} ref={ref} /></VariableSurface>;
});
