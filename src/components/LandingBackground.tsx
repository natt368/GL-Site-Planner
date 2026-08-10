import React from 'react';

/**
 * Self-contained illustrated landing background — a wheat field with
 * distant grain bins, rendered as inline SVG so there is no external
 * image file to fetch, cache, or fall back on.
 */
export const LandingBackground: React.FC = () => {
  return (
    <svg
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      width="100%"
      height="100%"
      className="block"
      role="img"
      aria-label="Illustrated wheat field with grain bins"
    >
      <defs>
        <linearGradient id="glSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#DCEAE9" />
          <stop offset="55%" stopColor="#EFEDE4" />
          <stop offset="100%" stopColor="#F7EFDC" />
        </linearGradient>
        <radialGradient id="glSun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F3E6D1" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#F3E6D1" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Sky */}
      <rect x="0" y="0" width="1600" height="620" fill="url(#glSky)" />

      {/* Sun glow + disc */}
      <circle cx="1180" cy="220" r="180" fill="url(#glSun)" />
      <circle cx="1180" cy="220" r="66" fill="#E0AE55" />
      <circle cx="1180" cy="220" r="66" fill="#B8842E" opacity="0.35" />

      {/* Birds */}
      <path d="M310 150 q14 -16 28 0 q14 -16 28 0" fill="none" stroke="#9A9682" strokeWidth="3" strokeLinecap="round" />
      <path d="M420 210 q11 -13 22 0 q11 -13 22 0" fill="none" stroke="#9A9682" strokeWidth="3" strokeLinecap="round" />

      {/* Back hill */}
      <path
        d="M0 560 C 220 500, 420 610, 680 555 C 960 495, 1220 590, 1600 530 L1600 900 L0 900 Z"
        fill="#E9DFC8"
      />

      {/* Grain bins on the back hill */}
      <g>
        <rect x="1040" y="470" width="46" height="70" rx="6" fill="#4C8886" />
        <path d="M1034 470 L1063 438 L1092 470 Z" fill="#3E7C7A" />
        <rect x="1104" y="486" width="34" height="54" rx="5" fill="#4C8886" />
        <path d="M1100 486 L1121 462 L1142 486 Z" fill="#3E7C7A" />
      </g>

      {/* Mid hill */}
      <path
        d="M0 630 C 260 570, 520 660, 800 615 C 1080 570, 1340 650, 1600 600 L1600 900 L0 900 Z"
        fill="#D9B872"
      />

      {/* Front hill / wheat field */}
      <path
        d="M0 700 C 300 650, 560 730, 900 680 C 1180 638, 1400 705, 1600 665 L1600 900 L0 900 Z"
        fill="#B8842E"
      />

      {/* Wheat stalks scattered across the foreground */}
      <g stroke="#7A4E10" strokeWidth="3" strokeLinecap="round">
        <line x1="80" y1="900" x2="72" y2="760" />
        <line x1="120" y1="900" x2="128" y2="770" />
        <line x1="160" y1="900" x2="150" y2="750" />
        <line x1="210" y1="900" x2="220" y2="775" />
        <line x1="260" y1="900" x2="250" y2="760" />
        <line x1="330" y1="900" x2="340" y2="780" />
        <line x1="390" y1="900" x2="380" y2="765" />
        <line x1="450" y1="900" x2="460" y2="785" />
        <line x1="520" y1="900" x2="510" y2="770" />
        <line x1="590" y1="900" x2="600" y2="790" />
        <line x1="660" y1="900" x2="650" y2="775" />
        <line x1="730" y1="900" x2="740" y2="795" />
        <line x1="810" y1="900" x2="800" y2="782" />
        <line x1="890" y1="900" x2="900" y2="800" />
        <line x1="970" y1="900" x2="960" y2="788" />
        <line x1="1050" y1="900" x2="1060" y2="805" />
        <line x1="1130" y1="900" x2="1120" y2="792" />
        <line x1="1210" y1="900" x2="1220" y2="808" />
        <line x1="1290" y1="900" x2="1280" y2="795" />
        <line x1="1370" y1="900" x2="1380" y2="812" />
        <line x1="1450" y1="900" x2="1440" y2="798" />
        <line x1="1520" y1="900" x2="1530" y2="815" />
      </g>
      <g fill="#8C6425">
        <ellipse cx="72" cy="756" rx="8" ry="14" />
        <ellipse cx="128" cy="766" rx="8" ry="14" />
        <ellipse cx="150" cy="746" rx="8" ry="14" />
        <ellipse cx="220" cy="771" rx="8" ry="14" />
        <ellipse cx="250" cy="756" rx="8" ry="14" />
        <ellipse cx="340" cy="776" rx="8" ry="14" />
        <ellipse cx="380" cy="761" rx="8" ry="14" />
        <ellipse cx="460" cy="781" rx="8" ry="14" />
        <ellipse cx="510" cy="766" rx="8" ry="14" />
        <ellipse cx="600" cy="786" rx="8" ry="14" />
        <ellipse cx="650" cy="771" rx="8" ry="14" />
        <ellipse cx="740" cy="791" rx="8" ry="14" />
        <ellipse cx="800" cy="778" rx="8" ry="14" />
        <ellipse cx="900" cy="796" rx="8" ry="14" />
        <ellipse cx="960" cy="784" rx="8" ry="14" />
        <ellipse cx="1060" cy="801" rx="8" ry="14" />
        <ellipse cx="1120" cy="788" rx="8" ry="14" />
        <ellipse cx="1220" cy="804" rx="8" ry="14" />
        <ellipse cx="1280" cy="791" rx="8" ry="14" />
        <ellipse cx="1380" cy="808" rx="8" ry="14" />
        <ellipse cx="1440" cy="794" rx="8" ry="14" />
        <ellipse cx="1530" cy="811" rx="8" ry="14" />
      </g>
    </svg>
  );
};
