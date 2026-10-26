// Avatares do Conecta TV — ilustrações próprias, desenhadas para o aplicativo.
//
// Cada avatar é um SVG pequeno (sem imagem externa, sem gradiente com id, para
// poder repetir o mesmo avatar várias vezes na tela). `svg(id)` devolve o
// desenho pronto; `lista` traz os ids e nomes para a tela de escolha.
(function () {
  const OLHO = (x, y, r = 3.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#1a202c"/><circle cx="${x + r * 0.35}" cy="${y - r * 0.35}" r="${r * 0.32}" fill="#fff"/>`;
  const SORRISO = (y = 70, w = 7, cor = '#1a202c') => `<path d="M${50 - w} ${y} q${w} ${w * 0.8} ${w * 2} 0" stroke="${cor}" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
  const BOCHECHAS = (y = 62, dx = 17, cor = '#fbb6ce') => `<circle cx="${50 - dx}" cy="${y}" r="4.2" fill="${cor}" opacity=".8"/><circle cx="${50 + dx}" cy="${y}" r="4.2" fill="${cor}" opacity=".8"/>`;

  const AVATARES = [
    ['robo', 'Robô', '#2b6cb0', '#63b3ed', `
      <line x1="50" y1="15" x2="50" y2="27" stroke="#e2e8f0" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="13" r="5" fill="#f6e05e"/>
      <rect x="17" y="41" width="8" height="16" rx="3" fill="#a0aec0"/><rect x="75" y="41" width="8" height="16" rx="3" fill="#a0aec0"/>
      <rect x="24" y="27" width="52" height="44" rx="13" fill="#e2e8f0"/>
      <rect x="31" y="37" width="38" height="18" rx="9" fill="#1a202c"/>
      <circle cx="42" cy="46" r="4.5" fill="#68d391"/><circle cx="58" cy="46" r="4.5" fill="#68d391"/>
      <rect x="40" y="60" width="20" height="4" rx="2" fill="#a0aec0"/>
      <rect x="33" y="74" width="34" height="30" rx="9" fill="#cbd5e0"/><circle cx="50" cy="86" r="4" fill="#fc8181"/>`],
    ['gato', 'Gato', '#6b46c1', '#b794f4', `
      <path d="M25 47 L29 17 L47 34 Z" fill="#f6ad55"/><path d="M75 47 L71 17 L53 34 Z" fill="#f6ad55"/>
      <path d="M30 39 L32 25 L41 33 Z" fill="#fbb6ce"/><path d="M70 39 L68 25 L59 33 Z" fill="#fbb6ce"/>
      <path d="M22 100 Q50 74 78 100 Z" fill="#f6ad55"/>
      <ellipse cx="50" cy="57" rx="30" ry="27" fill="#f6ad55"/>
      <path d="M45 33 v8 M50 31 v10 M55 33 v8" stroke="#dd6b20" stroke-width="3" stroke-linecap="round"/>
      ${OLHO(39, 54, 4.2)}${OLHO(61, 54, 4.2)}
      <path d="M46 63 h8 l-4 4z" fill="#e53e3e"/>
      <path d="M50 67 q-4 5 -8 2 M50 67 q4 5 8 2" stroke="#1a202c" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M22 60 l12 1 M22 66 l12 -1 M78 60 l-12 1 M78 66 l-12 -1" stroke="#fff" stroke-width="1.6" stroke-linecap="round" opacity=".9"/>`],
    ['raposa', 'Raposa', '#276749', '#68d391', `
      <path d="M23 48 L27 14 L47 32 Z" fill="#dd6b20"/><path d="M77 48 L73 14 L53 32 Z" fill="#dd6b20"/>
      <path d="M29 38 L30 23 L40 32 Z" fill="#2d3748"/><path d="M71 38 L70 23 L60 32 Z" fill="#2d3748"/>
      <path d="M18 44 Q50 20 82 44 Q78 72 50 88 Q22 72 18 44 Z" fill="#ed8936"/>
      <path d="M20 52 Q38 58 50 88 Q27 74 20 52 Z" fill="#fff"/><path d="M80 52 Q62 58 50 88 Q73 74 80 52 Z" fill="#fff"/>
      ${OLHO(37, 52)}${OLHO(63, 52)}
      <circle cx="50" cy="82" r="4.5" fill="#1a202c"/>`],
    ['coruja', 'Coruja', '#1a365d', '#4299e1', `
      <path d="M21 36 L27 18 L39 30 Z" fill="#975a16"/><path d="M79 36 L73 18 L61 30 Z" fill="#975a16"/>
      <ellipse cx="50" cy="62" rx="32" ry="35" fill="#975a16"/>
      <ellipse cx="50" cy="78" rx="18" ry="17" fill="#f6e05e" opacity=".85"/>
      <path d="M42 74 q2 3 4 0 M54 74 q2 3 4 0 M48 82 q2 3 4 0" stroke="#b7791f" stroke-width="2" fill="none"/>
      <circle cx="37" cy="48" r="12" fill="#fff"/><circle cx="63" cy="48" r="12" fill="#fff"/>
      ${OLHO(38, 49, 6)}${OLHO(62, 49, 6)}
      <path d="M45 58 L55 58 L50 67 Z" fill="#ed8936"/>`],
    ['urso', 'Urso', '#c05621', '#f6ad55', `
      <circle cx="27" cy="31" r="12" fill="#744210"/><circle cx="73" cy="31" r="12" fill="#744210"/>
      <circle cx="27" cy="31" r="5.5" fill="#d69e2e"/><circle cx="73" cy="31" r="5.5" fill="#d69e2e"/>
      <path d="M20 100 Q50 76 80 100 Z" fill="#975a16"/>
      <circle cx="50" cy="56" r="30" fill="#975a16"/>
      <ellipse cx="50" cy="67" rx="14" ry="11" fill="#fbd38d"/>
      ${OLHO(38, 50)}${OLHO(62, 50)}
      <ellipse cx="50" cy="62" rx="5.5" ry="3.8" fill="#1a202c"/>
      <path d="M50 65 v4 M45 71 q5 4 10 0" stroke="#1a202c" stroke-width="2.2" fill="none" stroke-linecap="round"/>`],
    ['panda', 'Panda', '#22543d', '#9ae6b4', `
      <circle cx="27" cy="31" r="11" fill="#1a202c"/><circle cx="73" cy="31" r="11" fill="#1a202c"/>
      <path d="M20 100 Q50 76 80 100 Z" fill="#fff"/>
      <circle cx="50" cy="56" r="31" fill="#fff"/>
      <ellipse cx="38" cy="52" rx="8" ry="10.5" transform="rotate(-25 38 52)" fill="#1a202c"/>
      <ellipse cx="62" cy="52" rx="8" ry="10.5" transform="rotate(25 62 52)" fill="#1a202c"/>
      <circle cx="39" cy="51" r="3.2" fill="#fff"/><circle cx="61" cy="51" r="3.2" fill="#fff"/>
      <ellipse cx="50" cy="64" rx="5" ry="3.6" fill="#1a202c"/>
      ${SORRISO(69, 5)}${BOCHECHAS(64, 19)}`],
    ['astronauta', 'Astronauta', '#1a202c', '#553c9a', `
      <circle cx="17" cy="20" r="1.6" fill="#fff"/><circle cx="84" cy="70" r="1.4" fill="#fff"/><circle cx="12" cy="68" r="1.2" fill="#fff"/><circle cx="88" cy="30" r="1.8" fill="#faf089"/>
      <rect x="28" y="78" width="44" height="26" rx="10" fill="#e2e8f0"/><circle cx="42" cy="88" r="3" fill="#fc8181"/><circle cx="52" cy="88" r="3" fill="#63b3ed"/>
      <circle cx="50" cy="48" r="31" fill="#edf2f7"/><circle cx="50" cy="48" r="31" fill="none" stroke="#a0aec0" stroke-width="2"/>
      <rect x="27" y="32" width="46" height="33" rx="16" fill="#2d3748"/>
      <path d="M34 41 q6 -6 14 -6" stroke="#90cdf4" stroke-width="3" fill="none" stroke-linecap="round"/>
      <circle cx="42" cy="49" r="2.8" fill="#90cdf4"/><circle cx="58" cy="49" r="2.8" fill="#90cdf4"/>
      ${SORRISO(55, 6, '#90cdf4')}
      <circle cx="50" cy="15" r="4" fill="#fc8181"/>`],
    ['alien', 'Alien', '#322659', '#9f7aea', `
      <path d="M41 24 L33 9 M59 24 L67 9" stroke="#68d391" stroke-width="3" stroke-linecap="round"/><circle cx="33" cy="9" r="4" fill="#f6e05e"/><circle cx="67" cy="9" r="4" fill="#f6e05e"/>
      <path d="M30 100 Q50 84 70 100 Z" fill="#48bb78"/>
      <path d="M50 19 C77 19 83 45 75 63 C69 77 59 88 50 88 C41 88 31 77 25 63 C17 45 23 19 50 19 Z" fill="#68d391"/>
      <ellipse cx="38" cy="54" rx="8.5" ry="12.5" transform="rotate(28 38 54)" fill="#1a202c"/>
      <ellipse cx="62" cy="54" rx="8.5" ry="12.5" transform="rotate(-28 62 54)" fill="#1a202c"/>
      <circle cx="40" cy="49" r="2.6" fill="#fff"/><circle cx="60" cy="49" r="2.6" fill="#fff"/>
      ${SORRISO(75, 5, '#22543d')}`],
    ['fantasma', 'Fantasma', '#2c5282', '#90cdf4', `
      <path d="M26 88 V48 C26 29 38 17 50 17 C62 17 74 29 74 48 V88 L66 81 L58 88 L50 81 L42 88 L34 81 Z" fill="#fff"/>
      <ellipse cx="41" cy="47" rx="4.8" ry="6.8" fill="#2d3748"/><ellipse cx="59" cy="47" rx="4.8" ry="6.8" fill="#2d3748"/>
      <circle cx="42.5" cy="44.5" r="1.6" fill="#fff"/><circle cx="60.5" cy="44.5" r="1.6" fill="#fff"/>
      ${BOCHECHAS(58, 16)}
      <ellipse cx="50" cy="61" rx="4.5" ry="5.5" fill="#2d3748"/>`],
    ['pinguim', 'Pinguim', '#2b6cb0', '#bee3f8', `
      <path d="M22 70 Q14 82 22 92 L28 76 Z M78 70 Q86 82 78 92 L72 76 Z" fill="#1a202c"/>
      <ellipse cx="50" cy="60" rx="30" ry="37" fill="#1a202c"/>
      <ellipse cx="50" cy="64" rx="21" ry="28" fill="#fff"/>
      ${OLHO(41, 46)}${OLHO(59, 46)}
      <path d="M43 54 L57 54 L50 63 Z" fill="#f6ad55"/>
      ${BOCHECHAS(57, 15)}`],
    ['cachorro', 'Cachorro', '#b7791f', '#faf089', `
      <path d="M22 100 Q50 78 78 100 Z" fill="#c98b4f"/>
      <ellipse cx="50" cy="54" rx="27" ry="28" fill="#c98b4f"/>
      <ellipse cx="25" cy="50" rx="10" ry="21" transform="rotate(18 25 50)" fill="#744210"/>
      <ellipse cx="75" cy="50" rx="10" ry="21" transform="rotate(-18 75 50)" fill="#744210"/>
      <circle cx="61" cy="41" r="8" fill="#975a16" opacity=".55"/>
      <ellipse cx="50" cy="66" rx="14" ry="11" fill="#fefcbf"/>
      ${OLHO(40, 49)}${OLHO(60, 49)}
      <ellipse cx="50" cy="61" rx="5.5" ry="4" fill="#1a202c"/>
      <path d="M50 65 v3 M44 69 q6 4 12 0" stroke="#1a202c" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M47 71 q3 9 6 0 z" fill="#fc8181"/>`],
    ['coelho', 'Coelho', '#b83280', '#fbb6ce', `
      <ellipse cx="38" cy="25" rx="7.5" ry="21" transform="rotate(-8 38 25)" fill="#fff"/><ellipse cx="62" cy="25" rx="7.5" ry="21" transform="rotate(8 62 25)" fill="#fff"/>
      <ellipse cx="38" cy="26" rx="3.5" ry="14" transform="rotate(-8 38 26)" fill="#fbb6ce"/><ellipse cx="62" cy="26" rx="3.5" ry="14" transform="rotate(8 62 26)" fill="#fbb6ce"/>
      <path d="M24 100 Q50 80 76 100 Z" fill="#fff"/>
      <circle cx="50" cy="61" r="27" fill="#fff"/>
      ${OLHO(40, 57)}${OLHO(60, 57)}
      <path d="M47 65 h6 l-3 3.5 z" fill="#ed64a6"/>
      <path d="M50 68.5 v2.5 M45 72 q5 3 10 0" stroke="#4a5568" stroke-width="1.8" fill="none" stroke-linecap="round"/>
      <rect x="47.3" y="72.5" width="5.4" height="5" rx="1" fill="#fff" stroke="#cbd5e0" stroke-width="1"/>
      ${BOCHECHAS(66, 17)}`],
    ['monstrinho', 'Monstrinho', '#9b2c2c', '#feb2b2', `
      <path d="M31 36 L23 14 L42 28 Z" fill="#fefcbf"/><path d="M69 36 L77 14 L58 28 Z" fill="#fefcbf"/>
      <path d="M21 104 V54 C21 35 34 24 50 24 C66 24 79 35 79 54 V104 Z" fill="#4fd1c5"/>
      <circle cx="35" cy="34" r="3" fill="#38b2ac"/><circle cx="68" cy="40" r="2.5" fill="#38b2ac"/><circle cx="30" cy="80" r="3.5" fill="#38b2ac"/>
      <circle cx="50" cy="51" r="14" fill="#fff"/>${OLHO(52, 52, 6.5)}
      <path d="M35 72 Q50 86 65 72 Z" fill="#1a202c"/>
      <path d="M41 73 l3.5 5.5 l3.5 -5.5 z M52 73 l3.5 5.5 l3.5 -5.5 z" fill="#fff"/>`],
    ['dino', 'Dino', '#285e61', '#81e6d9', `
      <path d="M29 33 l7 -12 l7 12 z M43 27 l7 -12 l7 12 z M57 33 l7 -12 l7 12 z" fill="#f6e05e"/>
      <path d="M26 100 Q50 80 74 100 Z" fill="#38a169"/>
      <rect x="21" y="30" width="58" height="52" rx="25" fill="#48bb78"/>
      <circle cx="37" cy="50" r="8" fill="#fff"/><circle cx="63" cy="50" r="8" fill="#fff"/>
      ${OLHO(38, 51, 4)}${OLHO(62, 51, 4)}
      <circle cx="44" cy="64" r="1.8" fill="#22543d"/><circle cx="56" cy="64" r="1.8" fill="#22543d"/>
      <path d="M36 71 q14 9 28 0" stroke="#22543d" stroke-width="2.6" fill="none" stroke-linecap="round"/>
      <circle cx="30" cy="40" r="2.5" fill="#68d391"/><circle cx="72" cy="66" r="3" fill="#68d391"/>`],
    ['leao', 'Leão', '#9c4221', '#fbd38d', `
      <circle cx="50" cy="52" r="35" fill="#c05621"/><circle cx="50" cy="52" r="30" fill="#dd6b20"/>
      <circle cx="33" cy="35" r="7" fill="#f6ad55"/><circle cx="67" cy="35" r="7" fill="#f6ad55"/>
      <circle cx="50" cy="55" r="23" fill="#f6ad55"/>
      ${OLHO(42, 50, 3.2)}${OLHO(58, 50, 3.2)}
      <ellipse cx="50" cy="64" rx="10" ry="7.5" fill="#fefcbf"/>
      <path d="M45.5 59 h9 l-4.5 4.5 z" fill="#744210"/>
      <path d="M50 63.5 v3 M46 68 q4 3 8 0" stroke="#744210" stroke-width="1.8" fill="none" stroke-linecap="round"/>`],
    ['pipoca', 'Pipoca', '#c3001b', '#ff6b81', `
      <circle cx="34" cy="31" r="9.5" fill="#fff3d5"/><circle cx="46" cy="24" r="10.5" fill="#fff3d5"/><circle cx="59" cy="26" r="10" fill="#fff3d5"/>
      <circle cx="69" cy="33" r="8.5" fill="#fff3d5"/><circle cx="41" cy="36" r="8" fill="#ffe8a3"/><circle cx="56" cy="36" r="8.5" fill="#ffe8a3"/>
      <path d="M27 38 H73 L66 92 H34 Z" fill="#fff"/>
      <path d="M38 38 L41 92 M50 38 V92 M62 38 L59 92" stroke="#e50924" stroke-width="5.5"/>
      <rect x="35" y="52" width="30" height="20" rx="8" fill="#fff"/>
      ${OLHO(43, 60, 3)}${OLHO(57, 60, 3)}${SORRISO(66, 4.5)}`],
  ];

  const MAPA = new Map(AVATARES.map(([id, nome, fundo, brilho, desenho]) => [id, { id, nome, fundo, brilho, desenho }]));

  function svg(id, rotulo) {
    const a = MAPA.get(String(id)) || AVATARES.length && MAPA.get(AVATARES[0][0]);
    const titulo = rotulo ? `<title>${String(rotulo).replace(/[<&>"]/g, '')}</title>` : '';
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="${rotulo ? 'false' : 'true'}">${titulo}` +
      `<rect width="100" height="100" fill="${a.fundo}"/><circle cx="84" cy="14" r="44" fill="${a.brilho}" opacity=".45"/>` +
      `<circle cx="8" cy="98" r="26" fill="#000" opacity=".12"/>${a.desenho}</svg>`;
  }

  window.StreamAvatares = {
    lista: AVATARES.map(([id, nome]) => ({ id, nome })),
    existe: id => MAPA.has(String(id)),
    svg,
  };
})();
