import React from 'react';

interface KitaujiBrandLogoProps {
  readonly size?: number;
  readonly className?: string;
}

export const KitaujiBrandLogo: React.FC<KitaujiBrandLogoProps> = ({ size = 32, className = '' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`kitauji-brand-logo ${className}`}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <defs>
        <linearGradient id="kitaujiBrassGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f3e3b5" />
          <stop offset="35%" stopColor="#d4af37" />
          <stop offset="70%" stopColor="#aa8232" />
          <stop offset="100%" stopColor="#634516" />
        </linearGradient>
        <linearGradient id="kitaujiCrimsonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#804135" />
          <stop offset="50%" stopColor="#5d2a20" />
          <stop offset="100%" stopColor="#3d1810" />
        </linearGradient>
        <filter id="brassGlow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="1.5" floodColor="#2a120b" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Octagonal Crest Badge */}
      <path
        d="M14 4 L34 4 L44 14 L44 34 L34 44 L14 44 L4 34 L4 14 Z"
        fill="url(#kitaujiCrimsonGrad)"
        stroke="url(#kitaujiBrassGrad)"
        strokeWidth="2"
        filter="url(#brassGlow)"
      />

      {/* Inner Decorative Brass Frame */}
      <path
        d="M15.5 7.5 L32.5 7.5 L40.5 15.5 L40.5 32.5 L32.5 40.5 L15.5 40.5 L7.5 32.5 L7.5 15.5 Z"
        fill="none"
        stroke="url(#kitaujiBrassGrad)"
        strokeWidth="0.8"
        strokeOpacity="0.7"
      />

      {/* Euphonium / Horn Valve Ring Background */}
      <circle cx="24" cy="24" r="13" stroke="url(#kitaujiBrassGrad)" strokeWidth="0.8" strokeDasharray="2 2" strokeOpacity="0.5" />

      {/* Stylized '北' Calligraphy with Wind Instrument Curves */}
      <path
        d="M17 14.5 L17 33.5 M11.5 24.5 L17 24.5 M13 32 L17 26.5"
        stroke="url(#kitaujiBrassGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <path
        d="M26 15 L32 15 L32 21.5 M23 23.5 L35.5 23.5 M26 17 L26 31 C26 34 29 34 32.5 33.5 C34.5 33.2 36 32 36.5 30.5"
        stroke="url(#kitaujiBrassGrad)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Center Brass Melody Dot */}
      <circle cx="24" cy="24" r="1.2" fill="url(#kitaujiBrassGrad)" />
    </svg>
  );
};
