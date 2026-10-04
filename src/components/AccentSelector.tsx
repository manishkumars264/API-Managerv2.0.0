import { Check } from 'lucide-react';
import { useId } from 'react';
import { ACCENT_COLORS, ACCENT_PALETTES, DEFAULT_ACCENT, type AccentColor } from '../lib/appearance';
import './AccentSelector.css';

export interface AccentSelectorProps {
  value: AccentColor;
  onChange: (value: AccentColor) => void;
}

export function AccentSelector({ value, onChange }: AccentSelectorProps) {
  const groupId = useId();
  return <fieldset className="accent-selector">
    <legend>Accent color</legend>
    <div className="accent-selector-options">
      {ACCENT_COLORS.map(color => {
        const palette = ACCENT_PALETTES[color];
        return <label className="accent-choice" key={color}>
          <input className="accent-choice-input" type="radio" name={`${groupId}-accent`} value={color} aria-label={palette.label} checked={value === color} onChange={() => onChange(color)} />
          <span className="accent-choice-body">
            <span className="accent-choice-swatch" style={{ backgroundColor: palette.light.button }} aria-hidden="true">{value === color && <Check size={13} strokeWidth={2.5} />}</span>
            <span className="accent-choice-label">{palette.label}{color === DEFAULT_ACCENT && <small>Default</small>}</span>
          </span>
        </label>;
      })}
    </div>
  </fieldset>;
}

export default AccentSelector;
