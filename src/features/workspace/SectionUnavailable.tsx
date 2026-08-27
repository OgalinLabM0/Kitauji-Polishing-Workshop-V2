import type { LucideIcon } from 'lucide-react';

interface SectionUnavailableProps {
  readonly eyebrow: string;
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly availableNow: readonly string[];
  readonly remaining: readonly string[];
  readonly onOpenAvailable?: () => void;
  readonly openLabel?: string;
}

export const SectionUnavailable = ({
  eyebrow,
  title,
  description,
  icon: Icon,
  availableNow,
  remaining,
  onOpenAvailable,
  openLabel,
}: SectionUnavailableProps) => (
  <div className="workspace-scroll section-status-page">
    <header>
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      <Icon size={28} />
    </header>
    <div className="section-status-sheet">
      <section>
        <h2>现在可用</h2>
        <ul>{availableNow.map((item) => <li key={item}>{item}</li>)}</ul>
        {onOpenAvailable && openLabel && <button type="button" onClick={onOpenAvailable}>{openLabel}</button>}
      </section>
      <section>
        <h2>尚未接通</h2>
        <ul>{remaining.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>
    </div>
  </div>
);
