import type { NationalTotals, ProjectionMeta, ViewMode } from './types';

const LOGOMARK_SVG = `<g transform="translate(60, 95) scale(1.8)">
  <path d="M 100,10 L 103.5,32 L 96.5,32 Z" fill="#1F2E4D"/>
  <rect x="91" y="32" width="18" height="5" fill="#1F2E4D"/>
  <rect x="86" y="37" width="28" height="11" fill="#1F2E4D"/>
  <path d="M 50,132 C 50,82 72,55 100,55 C 128,55 150,82 150,132 Z" fill="#1F2E4D"/>
  <rect x="35" y="132" width="130" height="6" fill="#1F2E4D"/>
  <rect x="25" y="138" width="150" height="8" fill="#1F2E4D"/>
  <rect x="31" y="184" width="8" height="10" fill="#A04848"/>
  <rect x="44" y="181" width="8" height="13" fill="#974856"/>
  <rect x="57" y="178" width="8" height="16" fill="#8E4763"/>
  <rect x="70" y="174" width="8" height="20" fill="#844871"/>
  <rect x="83" y="171" width="8" height="23" fill="#774A80"/>
  <rect x="96" y="168" width="8" height="26" fill="#6B4C8E"/>
  <rect x="109" y="165" width="8" height="29" fill="#5F4F93"/>
  <rect x="122" y="162" width="8" height="32" fill="#535298"/>
  <rect x="135" y="158" width="8" height="36" fill="#475597"/>
  <rect x="148" y="155" width="8" height="39" fill="#3B5892"/>
  <rect x="161" y="152" width="8" height="42" fill="#2F5B8C"/>
  <rect x="20" y="194" width="160" height="6" fill="#1F2E4D"/>
</g>`;

export interface NationalShareParams {
  national: NationalTotals;
  meta: ProjectionMeta;
  viewMode: ViewMode;
}

function formatBallot(margin: number): string {
  if (margin >= 0) return `D+${margin.toFixed(1)}`;
  return `R+${Math.abs(margin).toFixed(1)}`;
}

function buildNationalCardSvg({ national, meta, viewMode }: NationalShareParams): string {
  const { projected, actual } = national;
  const dGain = projected.d_seats - actual.d_seats;

  let shiftLabel: string;
  let shiftColor: string;
  if (dGain > 0) {
    shiftLabel = `+${dGain} D / −${dGain} R under PR`;
    shiftColor = '#1F2E4D';
  } else if (dGain < 0) {
    shiftLabel = `−${Math.abs(dGain)} D / +${Math.abs(dGain)} R under PR`;
    shiftColor = '#A04848';
  } else {
    shiftLabel = 'No shift under PR';
    shiftColor = '#5C5C5A';
  }

  let modeLabel: string;
  if (viewMode === 'retrospective') {
    modeLabel = '2024 RETROSPECTIVE';
  } else if (viewMode === 'sandbox') {
    modeLabel = `SANDBOX · ${formatBallot(meta.generic_ballot_margin)}`;
  } else {
    modeLabel = `CURRENT POLLING · ${formatBallot(meta.generic_ballot_margin)}`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#F4EDE0"/>
  ${LOGOMARK_SVG}
  <text x="480" y="190" font-family="Georgia,'Times New Roman',serif" font-size="52" font-weight="500" fill="#1F2E4D" letter-spacing="-0.01em">The Proportional House</text>
  <text x="480" y="228" font-family="system-ui,-apple-system,sans-serif" font-size="14" letter-spacing="2" fill="#888780">${modeLabel}</text>

  <text x="480" y="315" font-family="system-ui,-apple-system,sans-serif" font-size="14" letter-spacing="2" fill="#888780">ACTUAL TODAY</text>
  <text x="480" y="365" font-family="system-ui,-apple-system,sans-serif" font-size="48" font-weight="600" xml:space="preserve"><tspan fill="#2166ac">D ${actual.d_seats}</tspan><tspan fill="#5C5C5A" font-weight="400">  ·  </tspan><tspan fill="#B2182B">R ${actual.r_seats}</tspan></text>

  <text x="820" y="315" font-family="system-ui,-apple-system,sans-serif" font-size="14" letter-spacing="2" fill="#888780">PROJECTED UNDER PR</text>
  <text x="820" y="365" font-family="system-ui,-apple-system,sans-serif" font-size="48" font-weight="600" xml:space="preserve"><tspan fill="#2166ac">D ${projected.d_seats}</tspan><tspan fill="#5C5C5A" font-weight="400">  ·  </tspan><tspan fill="#B2182B">R ${projected.r_seats}</tspan></text>

  <text x="480" y="445" font-family="Georgia,'Times New Roman',serif" font-size="28" font-style="italic" fill="${shiftColor}">${shiftLabel}</text>

  <text x="480" y="555" font-family="Georgia,'Times New Roman',serif" font-size="20" fill="#1F2E4D">The Proportional House</text>
  <text x="480" y="585" font-family="system-ui,-apple-system,sans-serif" font-size="14" fill="#888780">proportionalhouse.org</text>
</svg>`;
}

export function downloadNationalCard(params: NationalShareParams): void {
  const svg = buildNationalCardSvg(params);
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext('2d');
    if (!ctx) { URL.revokeObjectURL(url); return; }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `proportional-house-national-${params.viewMode}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  img.src = url;
}

export function buildNationalTweetIntent({ national, meta, viewMode }: NationalShareParams): string {
  const { projected, actual } = national;
  const dGain = projected.d_seats - actual.d_seats;

  const shiftPhrase =
    dGain > 0
      ? `+${dGain} Democratic / −${dGain} Republican from today`
      : dGain < 0
        ? `−${Math.abs(dGain)} Democratic / +${Math.abs(dGain)} Republican from today`
        : 'no net change from today';

  let text: string;
  if (viewMode === 'retrospective') {
    text = `If 2024’s House votes had used proportional representation: Democrats ${projected.d_seats} seats, Republicans ${projected.r_seats} — ${shiftPhrase}:`;
  } else if (viewMode === 'sandbox') {
    text = `Under a ${formatBallot(meta.generic_ballot_margin)} generic ballot with proportional representation: Democrats ${projected.d_seats} seats, Republicans ${projected.r_seats} — ${shiftPhrase}:`;
  } else {
    text = `Under proportional representation with current polling, Democrats would hold ${projected.d_seats} seats and Republicans ${projected.r_seats} — ${shiftPhrase}:`;
  }

  const SITE = 'https://proportionalhouse.org';
  let deepLink: string;
  if (viewMode === 'retrospective') {
    deepLink = `${SITE}/?view=retrospective`;
  } else if (viewMode === 'sandbox') {
    deepLink = `${SITE}/?view=sandbox&ballot=${meta.generic_ballot_margin.toFixed(1)}`;
  } else {
    deepLink = SITE;
  }

  return (
    'https://twitter.com/intent/tweet?text=' +
    encodeURIComponent(text) +
    '&url=' +
    encodeURIComponent(deepLink)
  );
}
