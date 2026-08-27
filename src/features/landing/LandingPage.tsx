import { useEffect, useState } from 'react';
import { ArrowRight, HelpCircle, Music2, Sparkles, Wind } from 'lucide-react';
import kitaujiMark from '../../assets/kitauji-mark.png';

interface LandingPageProps {
  readonly onEnter: () => void;
}

export const LandingPage = ({ onEnter }: LandingPageProps) => {
  const [mounted, setMounted] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => setMounted(true), []);

  const handleEnter = () => {
    if (isExiting) return;
    setIsExiting(true);
    window.setTimeout(onEnter, 800);
  };

  return (
    <main className={`landing-page${isExiting ? ' landing-page--exiting' : ''}`}>
      <div className="landing-background" aria-hidden="true">
        <div className="staff-lines" />
        <div className="ambient-light ambient-light--warm" />
        <div className="ambient-light ambient-light--uniform" />
        <Music2 className="floating-note" strokeWidth={1} />
        <Wind className="floating-wind" strokeWidth={0.6} />
        {Array.from({ length: 8 }, (_, index) => (
          <span className={`gold-particle gold-particle--${index + 1}`} key={index} />
        ))}
      </div>

      <section className={`landing-content${mounted ? ' landing-content--mounted' : ''}`}>
        <div className="emblem-wrap" aria-label="北宇治润色工坊徽章">
          <div className="emblem-halo" />
          <div className="emblem-disc">
            <span className="emblem-ring emblem-ring--outer" />
            <span className="emblem-ring emblem-ring--inner" />
            <img src={kitaujiMark} alt="北宇治润色工坊标志" />
            <span className="emblem-glint" />
          </div>
        </div>

        <div className="landing-title-block">
          <span className="vertical-note vertical-note--left" aria-hidden="true">響け！ユーフォニアム</span>
          <span className="vertical-note vertical-note--right" aria-hidden="true">北宇治高校吹奏楽部</span>

          <div className="school-kicker">
            <span />
            Kitauji High School
            <span />
          </div>
          <h1>
            <span>北宇治</span>
            <span>润色工坊</span>
          </h1>
          <p>「想要变得特别」—— 带着全书认知工作的日中小说翻译与润色工坊</p>
        </div>

        <div className="landing-actions">
          <button className="primary-entry" type="button" onClick={handleEnter}>
            <span className="button-shimmer" />
            <span className="button-label">
              <Sparkles size={16} />
              打开书架
              <ArrowRight size={18} />
            </span>
          </button>
          <button className="secondary-entry" type="button" onClick={() => setIsHelpOpen(true)}>
            <HelpCircle size={18} />
            了解 Version 2
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <div><span>✦</span><i /><span>✦</span></div>
        <p>Kitauji High School Concert Band · Translation Workshop</p>
      </footer>

      {isHelpOpen && (
        <div className="landing-dialog-backdrop" role="presentation" onMouseDown={() => setIsHelpOpen(false)}>
          <section className="landing-dialog" role="dialog" aria-modal="true" aria-labelledby="version-two-title" onMouseDown={(event) => event.stopPropagation()}>
            <p className="eyebrow">北宇治润色工坊</p>
            <h2 id="version-two-title">以匠心对待每一部轻小说与文学作品</h2>
            <p>北宇治润色工坊深度结合全书预读、专有名词统一、上下文事件记忆与多轮智能审校，带来精准、流畅且兼具文学美感的日中小说翻译与润色体验。</p>
            <button type="button" onClick={() => setIsHelpOpen(false)}>开启工坊之旅</button>
          </section>
        </div>
      )}
    </main>
  );
};
