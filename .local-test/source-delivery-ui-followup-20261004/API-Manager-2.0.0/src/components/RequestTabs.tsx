import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RequestTab } from '../types';
import './RequestTabs.css';

export interface RequestTabsProps {
  tabs: RequestTab[];
  activeTabId: string;
  isRequestActive: boolean;
  onSelect: (id: string) => void;
  onClose: (tab: RequestTab) => void;
  onNew: () => void;
}

export function RequestTabs({ tabs, activeTabId, isRequestActive, onSelect, onClose, onNew }: RequestTabsProps) {
  const area = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const tabElements = useRef(new Map<string, HTMLDivElement>());
  const latest = useRef({ tabs, activeTabId, onSelect });
  latest.current = { tabs, activeTabId, onSelect };
  const [navigation, setNavigation] = useState({ overflow: false, left: false, right: false });
  const tabOrder = tabs.map(tab => tab.id).join(':');

  const measure = () => {
    const list = viewport.current, space = area.current;
    if (!list || !space) return;
    // Compare against the space before arrows are allocated. Otherwise arrows
    // would remain visible after all tabs could fit in the complete viewport.
    const overflow = latest.current.tabs.length > 1 && list.scrollWidth > space.clientWidth + 1;
    const next = { overflow, left: list.scrollLeft > 1, right: list.scrollWidth - list.clientWidth - list.scrollLeft > 1 };
    setNavigation(previous => previous.overflow === next.overflow && previous.left === next.left && previous.right === next.right ? previous : next);
  };
  const reveal = (id: string) => {
    const list = viewport.current, element = tabElements.current.get(id);
    if (!list || !element) return;
    const bounds = list.getBoundingClientRect(), tab = element.getBoundingClientRect();
    if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left;
    else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right;
  };
  useLayoutEffect(() => {
    reveal(activeTabId); measure();
  }, [activeTabId, isRequestActive, tabOrder]);
  useLayoutEffect(() => { reveal(activeTabId); measure(); }, [navigation.overflow]);
  useEffect(() => {
    const list = viewport.current, space = area.current;
    if (!list || !space) return;
    const observer = new ResizeObserver(() => { reveal(latest.current.activeTabId); measure(); });
    observer.observe(list); observer.observe(space);
    list.addEventListener('scroll', measure, { passive: true });
    const wheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (!delta) return;
      if (event.ctrlKey) {
        event.preventDefault();
        const { tabs, activeTabId, onSelect } = latest.current;
        const index = Math.max(0, tabs.findIndex(tab => tab.id === activeTabId));
        const target = tabs[Math.max(0, Math.min(tabs.length - 1, index + (delta > 0 ? 1 : -1)))];
        if (target) onSelect(target.id);
      } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX) || !list.contains(event.target as Node)) {
        event.preventDefault();
        list.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? list.clientWidth : 1);
      }
    };
    space.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); list.removeEventListener('scroll', measure); space.removeEventListener('wheel', wheel); };
  }, []);

  const scroll = (direction: number) => viewport.current?.scrollBy({ left: direction * Math.max(120, viewport.current.clientWidth * .75), behavior: 'smooth' });
  const navigate = (event: React.KeyboardEvent, index: number) => {
    let target: RequestTab | undefined;
    if (event.key === 'ArrowLeft') target = tabs[Math.max(0, index - 1)];
    else if (event.key === 'ArrowRight') target = tabs[Math.min(tabs.length - 1, index + 1)];
    else if (event.key === 'Home') target = tabs[0];
    else if (event.key === 'End') target = tabs[tabs.length - 1];
    else return;
    if (!target) return;
    event.preventDefault(); onSelect(target.id); reveal(target.id);
    tabElements.current.get(target.id)?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus({ preventScroll: true });
  };
  return <div className="request-tabs-strip">
    <div className="request-tabs-area" ref={area}>
      {navigation.overflow && <button className="request-tabs-arrow icon-button" type="button" aria-label="Scroll request tabs left" title="Scroll request tabs left" disabled={!navigation.left} onClick={() => scroll(-1)}><ChevronLeft size={14} /></button>}
      <div className="request-tabs" ref={viewport} role="tablist" aria-label="Request tabs">
        {tabs.map((tab, index) => <div className={`request-tab ${tab.id === activeTabId && isRequestActive ? 'active' : ''}`} key={tab.id} ref={element => { if (element) tabElements.current.set(tab.id, element); else tabElements.current.delete(tab.id); }} onMouseDown={event => { if (event.button === 1) event.preventDefault(); }} onAuxClick={event => { if (event.button === 1) { event.preventDefault(); onClose(tab); } }}>
          <button role="tab" type="button" aria-selected={tab.id === activeTabId && isRequestActive} tabIndex={tab.id === activeTabId ? 0 : -1} onClick={() => onSelect(tab.id)} onKeyDown={event => navigate(event, index)} title={`${tab.request.method} ${tab.request.url || tab.request.name}`}><span className={`method-badge ${tab.request.method.toLowerCase()}`}>{tab.request.method}</span><span className="ellipsis">{tab.request.name}</span>{tab.dirty && <span className="dirty-dot" title="Unsaved collection changes" />}</button>
          <button type="button" className="tab-close" aria-label={`Close ${tab.request.name}`} title={`Close ${tab.request.name}`} onClick={() => onClose(tab)}><X size={11} /></button>
        </div>)}
      </div>
      {navigation.overflow && <button className="request-tabs-arrow icon-button" type="button" aria-label="Scroll request tabs right" title="Scroll request tabs right" disabled={!navigation.right} onClick={() => scroll(1)}><ChevronRight size={14} /></button>}
    </div>
    <button className="new-tab icon-button" type="button" title="New request (Ctrl+N)" aria-label="New request tab" onClick={onNew}><Plus size={15} /></button>
  </div>;
}

export default RequestTabs;
