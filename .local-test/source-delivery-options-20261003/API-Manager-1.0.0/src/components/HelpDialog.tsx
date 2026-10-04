import { useRef, useState } from 'react';
import { ArrowUpRight, BookOpen, Code2, History, Keyboard, Mail, MessageSquare, UserRound } from 'lucide-react';
import { currentRelease, releases } from '../lib/release-notes';
import './HelpDialog.css';

interface HelpDialogProps {
  onClose: () => void;
  onReportBug: () => void | Promise<void>;
}
type HelpTab = 'About' | 'Release notes' | 'Version history';
const tabs: { name: HelpTab; icon: typeof UserRound }[] = [
  { name: 'About', icon: UserRound },
  { name: 'Release notes', icon: BookOpen },
  { name: 'Version history', icon: History },
];
const shortcuts: { keys: string[]; action: string; scope?: string }[] = [
  { keys: ['Ctrl', 'N'], action: 'Open a new request tab' },
  { keys: ['Ctrl', 'Mouse wheel'], action: 'Navigate request tabs', scope: 'While the pointer is over the request tab area' },
  { keys: ['Middle click'], action: 'Close a request tab', scope: 'Unsaved drafts still require confirmation' },
  { keys: ['Arrow Up', 'Arrow Down'], action: 'Resize the Console', scope: 'Focus the Console divider; Shift changes height in larger steps, Home/End choose the available minimum/maximum' },
  { keys: ['Ctrl', 'S'], action: 'Save the request to a collection' },
  { keys: ['Ctrl', 'Enter'], action: 'Send the current request' },
  { keys: ['Ctrl', 'F'], action: 'Find text', scope: 'In a request, script, or response code editor' },
  { keys: ['Enter'], action: 'Go to the next search match', scope: 'When the editor Find input is focused; wraps to the first match' },
  { keys: ['Shift', 'Enter'], action: 'Go to the previous search match', scope: 'When the editor Find input is focused; wraps to the last match' },
  { keys: ['Ctrl', 'H'], action: 'Find and replace text', scope: 'In an editable code editor' },
  { keys: ['Ctrl', 'Z'], action: 'Undo an edit', scope: 'In an editable code editor' },
  { keys: ['Ctrl', 'Y'], action: 'Redo an edit', scope: 'Also Ctrl + Shift + Z in an editable code editor' },
  { keys: ['Esc'], action: 'Close an open dialog or menu' },
  { keys: ['Tab'], action: 'Move to the next control', scope: 'Shift + Tab moves to the previous control' },
];
const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const tabId = (name: HelpTab) => `api-help-${name.toLowerCase().replaceAll(' ', '-')}`;

/** Modal content only; the application owns the dialog frame and native email action. */
export function HelpDialog({ onClose, onReportBug }: HelpDialogProps) {
  const [activeTab, setActiveTab] = useState<HelpTab>('About');
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const navigateTab = (event: React.KeyboardEvent, index: number) => {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault(); setActiveTab(tabs[next].name); buttons.current[next]?.focus();
  };
  return <div className="api-help">
    <div className="api-help-brand"><span className="api-help-logo"><Code2 size={27} /></span><div><h3>API Manager</h3><p>A local workspace for your APIs.</p></div><span className="api-help-version">v{currentRelease.version}</span></div>
    <div className="api-help-tabs" role="tablist" aria-label="Help sections">{tabs.map(({ name, icon: Icon }, index) => <button key={name} ref={element => { buttons.current[index] = element; }} type="button" role="tab" id={`${tabId(name)}-tab`} aria-controls={`${tabId(name)}-panel`} aria-selected={activeTab === name} tabIndex={activeTab === name ? 0 : -1} className={activeTab === name ? 'active' : ''} onClick={() => setActiveTab(name)} onKeyDown={event => navigateTab(event, index)}><Icon size={14} />{name}</button>)}</div>
    <section className="api-help-panel" role="tabpanel" id={`${tabId(activeTab)}-panel`} aria-labelledby={`${tabId(activeTab)}-tab`} tabIndex={0}>
      {activeTab === 'About' && <>
        <div className="api-help-about"><div className="api-help-developer"><UserRound size={18} /><div><span>Developed by</span><strong>Manish Kumar Singh</strong></div></div><div className="api-help-contact"><Mail size={15} /><span>manishkumars264@gmail.com</span></div><p>API Manager keeps requests, collections, environments, globals, cookies, and sessions on this computer. Your workspace resumes when you reopen the application.</p><div className="api-help-meta"><span>Version {currentRelease.version}</span><span>{dateLabel(currentRelease.date)} · {currentRelease.title}</span></div></div>
        <div className="api-help-shortcuts"><h4><Keyboard size={15} />Keyboard shortcuts</h4><p>Request shortcuts apply while a dialog is closed. Editor shortcuts apply when the code editor has focus.</p><table><thead><tr><th>Shortcut</th><th>Action</th></tr></thead><tbody>{shortcuts.map(shortcut => <tr key={shortcut.keys.join('+')}><td><span className="api-help-keys">{shortcut.keys.map((key, index) => <span key={key}>{index > 0 && <i>+</i>}<kbd>{key}</kbd></span>)}</span></td><td>{shortcut.action}{shortcut.scope && <small>{shortcut.scope}</small>}</td></tr>)}</tbody></table></div>
      </>}
      {activeTab === 'Release notes' && <div className="api-help-release"><div className="api-help-release-heading"><div><span className="api-help-kicker">VERSION {currentRelease.version}</span><h4>{currentRelease.title}</h4></div><time dateTime={currentRelease.date}>{dateLabel(currentRelease.date)}</time></div><p className="api-help-release-summary">{currentRelease.summary}</p>{currentRelease.sections.map(section => <div className="api-help-release-section" key={section.title}><h5>{section.title}</h5><ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul></div>)}<p className="api-help-compatibility">This release implements the features listed above. Full Postman SDK parity, collection runners, automatic OAuth consent capture, WSDL operation generation, and cloud collaboration are outside its scope. Credentials and workspace data are saved locally as plain data.</p></div>}
      {activeTab === 'Version history' && <div className="api-help-history"><p>Application releases, newest first.</p>{releases.map(release => <article key={release.version}><span className="api-help-history-dot" /><div className="api-help-history-top"><h4>v{release.version}</h4><span>{release.title}</span><time dateTime={release.date}>{dateLabel(release.date)}</time></div><p>{release.summary}</p><span className="api-help-history-count">{release.sections.length} feature areas</span><button type="button" className="text-button" onClick={() => setActiveTab('Release notes')}>View full release notes<ArrowUpRight size={12} /></button></article>)}</div>}
    </section>
    <div className="api-help-report"><MessageSquare size={19} /><div><strong>Found a bug?</strong><p>Open a prepared draft in your default email app. Add the issue, reproduction steps, and screenshots or videos.</p></div><button type="button" className="button" onClick={onReportBug}><Mail size={14} />Report bugs</button></div>
    <div className="api-help-footer"><span>Local by design.</span><button type="button" className="button primary" onClick={onClose}>Done</button></div>
  </div>;
}

export default HelpDialog;
